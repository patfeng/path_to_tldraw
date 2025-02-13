import h5py
import math
import random
from tqdm import tqdm
from PIL import Image
from typing import List, Tuple
import os
import argparse
import requests
import glob
import base64
import io
import cairosvg
import multiprocessing
from functools import partial
import time

confidence_explanations = {
        1: "1 - Exceptionally unreadable, incomprehensible with any context. Refrain from putting obviously scribbled out text here.",
        2: "2 - Barely distinguishable marks, might hint at text/drawings but impossible to interpret meaningfully.",
        3: "3 - Few readable characters/elements, requires extensive context and guesswork to attempt interpretation.",
        4: "4 - Vaguely readable, or only certain portions readable, but only with significant context. Badly drawn diagrams and mostly illegible handwriting belongs here.",
        5: "5 - Mostly decipherable but requires concentration. Messy diagrams that convey basic meaning.",
        6: "6 - Readable with some context. Bad but legible handwriting that can be reasonably deciphered and unorthodox/messy diagrams belong here.",
        7: "7 - Generally readable with occasional unclear parts. Average student handwriting quality.",
        8: "8 - Readable with or without context. Decent handwriting that you expect from a student belongs here. Properly drawn diagrams are also acceptable.",
        9: "9 - Very good handwriting that is easily legible. There should be no errors in the text, but it could be slanted, misspelled, etc.",
        10: "10 - Perfectly readable without context. Reserve this for flawless handwriting that is unmistakeable for anything else."
    }


def pad_image(img: Image.Image) -> Image.Image:
    # Calculate the padding size (20% of the original dimensions)
    width, height = img.size
    pad_width = 30
    pad_height = 30

    # Create a new image with padding
    new_width = width + 2 * pad_width
    new_height = height + 2 * pad_height
    padded_img = Image.new(img.mode, (new_width, new_height), color='white')

    # Paste the original image onto the padded image
    padded_img.paste(img, (pad_width, pad_height))

    return padded_img


def count_vertices(svg_content: str) -> int:
    """Count the number of vertices in SVG paths"""
    import re
    # Find all path data strings
    path_data = re.findall(r'd="([^"]*)"', svg_content)
    vertex_count = 0
    
    for path in path_data:
        # Count commands that create vertices (M, L, H, V, C, S, Q, T, A)
        # Split on commands (both uppercase and lowercase)
        commands = re.findall(r'[MLHVCSQTAmlhvcsqta][^MLHVCSQTAmlhvcsqta]*', path)
        vertex_count += len(commands)
    
    return vertex_count

def svg_to_base64_image(svg_content: str) -> str:
    """Convert SVG to PNG with 1024px width, resize to 512, and return as base64"""
    import re
    
    # Try to get dimensions from viewBox first
    viewbox_match = re.search(r'viewBox="[^"]*?\s+[^"]*?\s+([^"]*?)\s+([^"]*?)"', svg_content)
    if viewbox_match:
        width = float(viewbox_match.group(1))
        height = float(viewbox_match.group(2))
    else:
        # Fall back to width/height attributes
        width_match = re.search(r'width="([^"]*?)"', svg_content)
        height_match = re.search(r'height="([^"]*?)"', svg_content)
        width = float(width_match.group(1)) if width_match else 1024
        height = float(height_match.group(1)) if height_match else 1024
    
    aspect_ratio = width / height
    # Calculate base target area and adjust by number of vertices
    base_target_area = 40000
    num_vertices = count_vertices(svg_content)
    target_area = base_target_area + (num_vertices * 800)
    # If width = height * aspect_ratio and width * height = target_area
    # Then: (height * aspect_ratio) * height = target_area
    # Therefore: height = sqrt(target_area / aspect_ratio)
    target_height = int(math.sqrt(target_area / aspect_ratio))
    target_width = int(target_height * aspect_ratio)
    
    # Remove label before converting
    svg_content = svg_content.split("<label>")[0]
    png_data = cairosvg.svg2png(
        bytestring=svg_content.encode('utf-8'),
        output_width=target_width,
        output_height=target_height,
        background_color='white'
    )
    
    # Convert PNG bytes to PIL Image
    img = Image.open(io.BytesIO(png_data))
    
    # Resize using 512
    img = pad_image(img)
        
    # Generate a unique filename using timestamp and random number
    # filename = f"./image_{int(time.time())}_{random.randint(1000, 9999)}.png"
    # resized_img.save(filename, format="PNG")
    
    # Convert to base64 as before
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

def extract_latex_from_svg(svg_content: str) -> str:
    """Extract LaTeX content from SVG label tag"""
    import re
    latex_match = re.search(r'<label>(.*?)</label>', svg_content)
    if latex_match:
        return latex_match.group(1)
    return ""

def process_svg_file(svg_file: str) -> dict:
    """Process a single SVG file and return the image and label"""
    with open(svg_file, 'r', encoding='utf-8') as f:
        svg_content = f.read()
    
    image = svg_to_base64_image(svg_content)
    label = extract_latex_from_svg(svg_content)
    
    return {
        'image': image,
        'label': label
    }

if __name__ == "__main__":
    # datasets = ['quickdraw', 'mathwriting', 'iam']
    datasets = ['quickdraw', 'iam']
    # Determine number of processes based on CPU cores
    num_processes = 20
    
    for dataset in datasets:
        files = glob.glob(f'./{dataset}_data/svgs/*.svg')
        items_per_file = 2000
        num_files = math.ceil(len(files) / items_per_file)
        print(f"Processing {dataset} dataset with {num_files} batches")
        for file_idx in range(num_files):
            start_idx = file_idx * items_per_file
            end_idx = min((file_idx + 1) * items_per_file, len(files))
            batch_files = files[start_idx:end_idx]
            
            # Process batch files in parallel
            with multiprocessing.Pool(processes=num_processes) as pool:
                batch = list(tqdm(
                    pool.imap(process_svg_file, batch_files),
                    total=len(batch_files),
                    desc=f"Processing batch {file_idx+1}"
                ))
            
            os.makedirs(f'./h5_data/{dataset}_tldraw', exist_ok=True)
            with h5py.File(f'./h5_data/{dataset}_tldraw/vision_data_{file_idx+1}.h5', 'w') as f:
                images = [item['image'] for item in batch]
                problems = ["Interactive Math Lesson, Generic" for _ in batch]
                labels = [f"<transcription>\n{item['label']}\n</transcription>" for item in batch]
                confidences = [7 for _ in batch]
                
                f.create_dataset('images', data=images)
                f.create_dataset('problems', data=problems)
                f.create_dataset('labels', data=labels)
                f.create_dataset('confidences', data=confidences)
            
            print(f"Created HDF5 file {file_idx+1}/{num_files}: vision_data_{file_idx+1}.h5")
    
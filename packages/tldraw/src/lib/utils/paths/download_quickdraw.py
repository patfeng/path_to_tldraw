from google.cloud import storage
import glob
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

def process_blob(blob, destination_dir):
    """
    Downloads and processes a single blob from the QuickDraw dataset
    """
    if not blob.name.endswith('.ndjson'):
        return
        
    destination_path = os.path.join(destination_dir, os.path.basename(blob.name))
    blob.download_to_filename(destination_path)
    
    # Keep only first 100 lines of the file
    with open(destination_path, 'r') as file:
        lines = file.readlines()[:100]
    with open(destination_path, 'w') as file:
        file.writelines(lines)
    return blob.name

def download_quickdraw_dataset():
    """
    Downloads the QuickDraw dataset from Google Cloud Storage.
    Uses anonymous access since this is a public dataset.
    """
    bucket_name = "quickdraw_dataset"
    prefix = "full/raw/"
    destination_dir = "./quickdraw_data/ndjsons"
    
    # Create destination directory if it doesn't exist
    os.makedirs(destination_dir, exist_ok=True)
    
    storage_client = storage.Client.create_anonymous_client()
    bucket = storage_client.bucket(bucket_name)
    
    # List all blobs
    print("Fetching file list...")
    blobs = list(bucket.list_blobs(prefix=prefix))
    ndjson_blobs = [b for b in blobs if b.name.endswith('.ndjson')]
    
    print(f"Found {len(ndjson_blobs)} .ndjson files to process")
    
    # Process blobs in parallel using ThreadPoolExecutor with progress bar
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [
            executor.submit(process_blob, blob, destination_dir)
            for blob in ndjson_blobs
        ]
        
        # Create progress bar
        with tqdm(total=len(ndjson_blobs), desc="Downloading files") as pbar:
            for future in as_completed(futures):
                try:
                    filename = future.result()
                    if filename:
                        pbar.update(1)
                        pbar.set_postfix_str(f"Last: {os.path.basename(filename)}")
                except Exception as e:
                    print(f"\nAn error occurred: {e}")

if __name__ == "__main__":
    download_quickdraw_dataset()
import requests
from tqdm import tqdm
import tarfile
import os

def download_file(url: str, destination: str) -> None:
    """
    Downloads a file from the given URL with a progress bar
    """
    response = requests.get(url, stream=True)
    total_size = int(response.headers.get('content-length', 0))
    
    with open(destination, 'wb') as file, tqdm(
        desc=destination,
        total=total_size,
        unit='iB',
        unit_scale=True,
        unit_divisor=1024,
    ) as progress_bar:
        for data in response.iter_content(chunk_size=1024):
            size = file.write(data)
            progress_bar.update(size)

def extract_tar(file_path: str, extract_path: str) -> None:
    """
    Extracts a tar file to the specified path
    """
    with tarfile.open(file_path, 'r:gz') as tar:
        tar.extractall(path=extract_path)

# URLs and paths
dataset_url = "https://storage.googleapis.com/mathwriting_data/mathwriting-2024.tgz"
download_path = "mathwriting-2024.tgz"
extract_path = "mathwriting_data"

# Create extract directory if it doesn't exist
os.makedirs(extract_path, exist_ok=True)

# Download the dataset
print("Downloading dataset...")
download_file(dataset_url, download_path)

# Extract the dataset
print("Extracting dataset...")
extract_tar(download_path, extract_path)

# Clean up the downloaded tar file
os.remove(download_path)

print("Download and extraction complete!")

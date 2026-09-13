"""
NSF HERD data downloader.

Ported from nsf-herd-mvp/scripts/etl/1_download.py, with one real change:
v1 always re-scraped and re-downloaded every year from a fixed start_year.
This version fetches one specific year at a time (`download_year`), since
this pipeline runs once a year for whatever NSF just published, not as a
full historical re-fetch.
"""

import io
import re
import zipfile
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://ncses.nsf.gov/explore-data/microdata/higher-education-research-development"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def discover_years(min_year: int = 2010) -> dict[int, str]:
    """Scrape NSF's HERD microdata page for ZIP download links, keyed by year.

    Matches filenames like Higher_Education_R_and_D_2023.zip -- excludes
    the "_short" variant (a summary file, not the full microdata).
    """
    response = requests.get(BASE_URL, headers=HEADERS, timeout=30)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    years: dict[int, str] = {}

    for link in soup.find_all("a", href=True):
        href = link["href"]
        if "higher_education_r_and_d_" in href.lower() and href.endswith(".zip") and "_short" not in href:
            year_match = re.search(r"_(\d{4})\.zip", href)
            if year_match:
                year = int(year_match.group(1))
                if year >= min_year:
                    years[year] = urljoin("https://ncses.nsf.gov", href)

    return years


def download_year(year: int, output_dir: Path, force: bool = False) -> list[Path]:
    """Download and extract one year's CSVs. Returns the extracted file paths.

    Skips the download (returns existing files) if CSVs for this year
    already exist on disk, unless force=True -- same idempotency check as
    v1, so re-running for an already-downloaded year is a safe no-op.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    existing = list(output_dir.glob(f"*{year}*.csv"))
    if existing and not force:
        print(f"   {year} already downloaded, skipping ({len(existing)} file(s))")
        return existing

    years = discover_years(min_year=year)
    if year not in years:
        raise ValueError(f"NSF does not currently publish a HERD dataset for {year}")

    url = years[year]
    print(f"   Downloading {year} from {url} ...")
    response = requests.get(url, headers=HEADERS, stream=True, timeout=120)
    response.raise_for_status()

    extracted = []
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        csv_files = [f for f in z.namelist() if f.endswith(".csv")]
        for csv_file in csv_files:
            csv_data = z.read(csv_file)
            output_path = output_dir / f"herd_{year}_{Path(csv_file).name}"
            output_path.write_bytes(csv_data)
            extracted.append(output_path)
            print(f"   Extracted {output_path.name}")

    return extracted

FROM python:3.11-slim

WORKDIR /ingestion

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# No long-running server -- this is invoked manually, e.g.:
#   docker compose run ingestion python pipeline.py --year 2025
#   docker compose run ingestion python check_new_year.py
CMD ["python", "pipeline.py", "--help"]

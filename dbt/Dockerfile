FROM python:3.11-slim

RUN pip install --no-cache-dir "dbt-core==1.8.2" "dbt-postgres==1.8.2"

WORKDIR /dbt

ENTRYPOINT ["dbt"]

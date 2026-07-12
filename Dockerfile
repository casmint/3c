FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/* \
    && git config --global --add safe.directory '*'

WORKDIR /app

COPY pyproject.toml .
COPY panel/ ./panel/
RUN pip install --no-cache-dir .

COPY static/ ./static/

EXPOSE 8000
CMD ["python", "-m", "panel"]

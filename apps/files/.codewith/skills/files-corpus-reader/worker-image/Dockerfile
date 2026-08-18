# syntax=docker/dockerfile:1
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        file \
        libarchive-tools \
        p7zip-full \
        python3 \
        unzip \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /usr/sbin/nologin extractor

WORKDIR /opt/open-files

COPY scripts/archive_inventory.py /opt/open-files/scripts/archive_inventory.py
COPY scripts/extraction_tool_inventory.py /opt/open-files/scripts/extraction_tool_inventory.py
COPY worker-image/smoke-archive-tools.sh /usr/local/bin/open-files-archive-tools-smoke

RUN chmod 0755 \
        /opt/open-files/scripts/archive_inventory.py \
        /opt/open-files/scripts/extraction_tool_inventory.py \
        /usr/local/bin/open-files-archive-tools-smoke

USER extractor

ENTRYPOINT ["python3"]
CMD ["/opt/open-files/scripts/extraction_tool_inventory.py"]

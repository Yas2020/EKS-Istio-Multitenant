FROM public.ecr.aws/docker/library/python:3.11.4-slim AS installer-image
WORKDIR /app
RUN DEBIAN_FRONTEND=noninteractive apt-get -qq update -y 2>/dev/null >/dev/null && \
    DEBIAN_FRONTEND=noninteractive apt-get -qq install -y \
    build-essential \
    curl 2>/dev/null >/dev/null \
    && rm -rf /var/lib/apt/lists/*
ADD api/requirements.txt ./
RUN pip install --upgrade -q -q pip && \
    pip install --user --upgrade -q -q pip && pip install --user -q -q -r requirements.txt && \
    python -m pip install --user -q -q botocore && \
    python -m pip install --user -q -q boto3

FROM public.ecr.aws/docker/library/python:3.11.4-slim
RUN DEBIAN_FRONTEND=noninteractive apt-get -qq update -y 2>/dev/null >/dev/null && \
    DEBIAN_FRONTEND=noninteractive apt-get -qq upgrade -y 2>/dev/null >/dev/null && \
    DEBIAN_FRONTEND=noninteractive apt install -qq -y curl 2>/dev/null >/dev/null && \
    addgroup --gid 8000 ragapi && \
    adduser --uid 8000 --gid 8000 --disabled-password --gecos "" ragapi
USER ragapi
WORKDIR /home/ragapi/app
COPY --chown=ragapi:ragapi --from=installer-image /root/.local /home/ragapi/.local/
COPY --chown=ragapi:ragapi api/app /home/ragapi/app/
ENV PATH=/home/ragapi/.local/bin:$PATH
EXPOSE 8000
ENTRYPOINT ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "main:app"]
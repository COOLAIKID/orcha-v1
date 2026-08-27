FROM python:3.11-slim
RUN useradd --create-home --shell /usr/sbin/nologin orcha
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .
RUN mkdir -p /var/lib/orcha/workspaces && chown -R orcha:orcha /app /var/lib/orcha
USER orcha
EXPOSE 8080
CMD ["uvicorn", "orcha.api.app:app", "--host", "0.0.0.0", "--port", "8080"]

import uvicorn

from panel.config import load_config

config = load_config()

from panel.app import create_app  # noqa: E402 — config must load first

app = create_app(config)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

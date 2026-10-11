from io import BytesIO
from typing import Any

import numpy as np
import orjson
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from PIL import Image

from immich_gemma.main import MODEL_NAME, app


class FakeEncoder:
    def encode_image(self, image: Image.Image) -> NDArray[np.float32]:
        return np.array([image.width, image.height, 0.5], dtype=np.float32)

    def encode_text(self, text: str) -> NDArray[np.float32]:
        return np.array([len(text), 0.25], dtype=np.float32)


@pytest.fixture
def client() -> TestClient:
    # not used as a context manager, so the lifespan that loads the real model does not run
    app.state.encoder = FakeEncoder()
    return TestClient(app)


def entries(model_type: str, task: str = "clip", model_name: str = MODEL_NAME, **options: Any) -> dict[str, str]:
    return {"entries": orjson.dumps({task: {model_type: {"modelName": model_name, "options": options}}}).decode()}


def jpeg(width: int, height: int) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height)).save(buffer, format="JPEG")
    return buffer.getvalue()


def test_ping(client: TestClient) -> None:
    response = client.get("/ping")

    assert response.status_code == 200
    assert response.text == "pong"


def test_text_gives_embedding_as_a_json_string(client: TestClient) -> None:
    response = client.post("/predict", data={**entries("textual", language="zh-CN"), "text": "海边"})

    assert response.status_code == 200
    assert response.json() == {"clip": "[2.0,0.25]"}


def test_image_gives_embedding_and_its_size(client: TestClient) -> None:
    response = client.post("/predict", data=entries("visual"), files={"image": jpeg(4, 3)})

    assert response.status_code == 200
    assert response.json() == {"clip": "[4.0,3.0,0.5]", "imageHeight": 3, "imageWidth": 4}


def test_image_that_is_not_an_image_is_rejected(client: TestClient) -> None:
    response = client.post("/predict", data=entries("visual"), files={"image": b"not an image"})

    assert response.status_code == 400


@pytest.mark.parametrize("model_type, data", [("visual", {"text": "海边"}), ("textual", {})])
def test_missing_input_is_rejected(client: TestClient, model_type: str, data: dict[str, str]) -> None:
    response = client.post("/predict", data={**entries(model_type), **data})

    assert response.status_code == 400


def test_other_model_is_rejected(client: TestClient) -> None:
    response = client.post("/predict", data={**entries("textual", model_name="ViT-B-32__openai"), "text": "海边"})

    assert response.status_code == 400
    assert "ViT-B-32__openai" in response.json()["detail"]


def test_other_task_is_rejected(client: TestClient) -> None:
    data = entries("detection", task="facial-recognition")

    response = client.post("/predict", data=data, files={"image": jpeg(4, 3)})

    assert response.status_code == 400


@pytest.mark.parametrize("raw", ["not json", "[]", '{"clip": {}}', '{"clip": {"textual": {}}}'])
def test_malformed_entries_are_rejected(client: TestClient, raw: str) -> None:
    response = client.post("/predict", data={"entries": raw, "text": "海边"})

    assert response.status_code == 422

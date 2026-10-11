import os
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Any, AsyncIterator, Literal, Protocol

import numpy as np
import orjson
from fastapi import Depends, FastAPI, File, Form, HTTPException
from fastapi.responses import PlainTextResponse
from numpy.typing import NDArray
from PIL import Image, UnidentifiedImageError

MODEL_ID = os.getenv("GEMMA_MODEL", "google/embeddinggemma-2")
MODEL_NAME = MODEL_ID.split("/")[-1]
DEVICE = os.getenv("GEMMA_DEVICE", "cuda")

ModelType = Literal["visual", "textual"]


class Encoder(Protocol):
    def encode_image(self, image: Image.Image) -> NDArray[np.float32]: ...

    def encode_text(self, text: str) -> NDArray[np.float32]: ...


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # imported here because it pulls in torch
    from immich_gemma.encoder import GemmaEncoder

    app.state.encoder = GemmaEncoder(MODEL_ID, DEVICE)
    yield


app = FastAPI(lifespan=lifespan)


def get_model_type(entries: str = Form()) -> ModelType:
    try:
        ((task, types),) = orjson.loads(entries).items()
        ((model_type, entry),) = types.items()
        model_name = entry["modelName"]
    except (orjson.JSONDecodeError, KeyError, ValueError, AttributeError, TypeError):
        raise HTTPException(422, "Invalid request format.")

    if task != "clip" or model_type not in ("visual", "textual"):
        raise HTTPException(400, f"Unsupported task '{task}' of type '{model_type}'")
    if model_name != MODEL_NAME:
        raise HTTPException(400, f"This server only has the model '{MODEL_NAME}', not '{model_name}'")
    return model_type


def serialize(embedding: NDArray[np.float32]) -> str:
    return orjson.dumps(embedding, option=orjson.OPT_SERIALIZE_NUMPY).decode()


@app.get("/ping")
def ping() -> PlainTextResponse:
    return PlainTextResponse("pong")


@app.post("/predict")
def predict(
    model_type: ModelType = Depends(get_model_type),
    image: bytes | None = File(default=None),
    text: str | None = Form(default=None),
) -> dict[str, Any]:
    encoder: Encoder = app.state.encoder

    if model_type == "textual":
        if text is None:
            raise HTTPException(400, "Text must be provided")
        return {"clip": serialize(encoder.encode_text(text))}

    if image is None:
        raise HTTPException(400, "Image must be provided")
    try:
        decoded = Image.open(BytesIO(image))
        decoded.load()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "Image could not be decoded")
    if decoded.width == 0 or decoded.height == 0:
        raise HTTPException(400, "Image has zero width or height")

    embedding = encoder.encode_image(decoded.convert("RGB"))
    return {"clip": serialize(embedding), "imageHeight": decoded.height, "imageWidth": decoded.width}

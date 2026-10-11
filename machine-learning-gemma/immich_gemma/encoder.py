import threading
from typing import Any

import numpy as np
import torch
from numpy.typing import NDArray
from PIL import Image
from sentence_transformers import SentenceTransformer


class GemmaEncoder:
    def __init__(self, model_id: str, device: str) -> None:
        # the model's activations overflow float16; bfloat16 keeps the float32 exponent range
        dtype = torch.bfloat16 if device.startswith("cuda") and torch.cuda.is_bf16_supported() else torch.float32
        self.model = SentenceTransformer(
            model_id,
            device=device,
            model_kwargs={"torch_dtype": dtype},
            config_kwargs={"audio_config": None},
        )
        self.lock = threading.Lock()

    def encode_image(self, image: Image.Image) -> NDArray[np.float32]:
        return self._encode(image)

    def encode_text(self, text: str) -> NDArray[np.float32]:
        return self._encode(text, prompt_name="SearchQuery")

    def _encode(self, inputs: Image.Image | str, **kwargs: Any) -> NDArray[np.float32]:
        with self.lock:
            embedding = self.model.encode(inputs, convert_to_tensor=True, **kwargs)
        # normalized as float32, bfloat16 being too coarse to give a unit length
        return torch.nn.functional.normalize(embedding.float(), dim=-1).cpu().numpy()

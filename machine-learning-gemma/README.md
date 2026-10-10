# Immich Gemma

[EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2) behind the protocol of Immich Machine Learning, so that the server can ask it for image and text embeddings the way it asks for CLIP ones. It is what the Gemma choice on the search page talks to; see `docs/fork-features.md`.

- `GET /ping` answers `pong`.
- `POST /predict` takes the same form as Immich Machine Learning, for the `clip` task only (`visual` with an `image`, `textual` with a `text`) and for the model name `embeddinggemma-2` only. The embedding has 768 dimensions.
- Text is encoded as a search query, with the model's `SearchQuery` prompt. The `language` option is accepted and ignored: the model needs no language tag.

The upstream service runs ONNX models and the model has no ONNX release, hence a service of its own on PyTorch.

# Setup

This project uses [uv](https://docs.astral.sh/uv/getting-started/installation/). `uv sync --locked` installs everything, with the CUDA 13 build of PyTorch, so Linux only.

- `uv run pytest` runs the tests. They use a stand-in for the model and need no GPU.
- `uv run ruff format . && uv run ruff check .` formats and lints.
- `uv run uvicorn immich_gemma.main:app --port 3003` runs the service, loading the model first.

# Settings

| Variable       | Default                   | Meaning                                                                             |
| :------------- | :------------------------ | :---------------------------------------------------------------------------------- |
| `GEMMA_MODEL`  | `google/embeddinggemma-2` | The model on Hugging Face. Its last part is the model name the server must ask for. |
| `GEMMA_DEVICE` | `cuda`                    | Where to run. `cpu` works but takes seconds per image.                              |
| `HF_HOME`      | `/cache` in the image     | Where the model is downloaded to (about 1.5 GB). Mount a volume there.              |

# Docker

```bash
docker build -t immich-gemma machine-learning-gemma
docker run --gpus all -p 3003:3003 -v gemma-cache:/cache immich-gemma
```

The service does not start without the device it was told to use. On a machine with unified memory that has been up for weeks, creating the CUDA context can fail with an out of memory error while memory is free but fragmented; compacting memory or dropping the page cache gets it going again.

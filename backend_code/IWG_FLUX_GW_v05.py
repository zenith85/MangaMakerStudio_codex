import gradio as gr
import numpy as np
import random
import torch
from diffusers import FluxTransformer2DModel, FluxPipeline
from transformers import T5EncoderModel, CLIPTextModel
from optimum.quanto import QuantizedDiffusersModel, QuantizedTransformersModel
from datetime import datetime
from PIL import Image
import devicetorch
import os

# Custom Quantized Model Class
class QuantizedFluxTransformer2DModel(QuantizedDiffusersModel):
    base_class = FluxTransformer2DModel

# Setup device and dtype
#dtype = torch.bfloat16
dtype = torch.float16
device = devicetorch.get(torch)
MAX_SEED = np.iinfo(np.int32).max
MAX_IMAGE_SIZE = 2048
selected = None  # Track currently loaded model
pipe = None  # Global pipeline variable

# --- Manga Mode / LoRA additions ---
LORA_DIR = "loras"
os.makedirs(LORA_DIR, exist_ok=True)
loaded_lora_adapters = set()  # adapter names already loaded into pipe via load_lora_weights

def list_available_loras():
    """Scan LORA_DIR for .safetensors files, return adapter names (filename without extension)."""
    if not os.path.isdir(LORA_DIR):
        return []
    return sorted(
        os.path.splitext(f)[0] for f in os.listdir(LORA_DIR) if f.endswith(".safetensors")
    )

def ensure_loras_loaded(adapter_names):
    """Load any requested LoRA that isn't already resident in the pipeline. Cheap no-op for ones already loaded."""
    global pipe
    for name in adapter_names:
        if name in loaded_lora_adapters:
            continue
        lora_path = os.path.join(LORA_DIR, f"{name}.safetensors")
        if not os.path.isfile(lora_path):
            raise FileNotFoundError(f"LoRA file not found: {lora_path}")
        pipe.load_lora_weights(lora_path, adapter_name=name)
        loaded_lora_adapters.add(name)

# Ensure width and height are multiples of 8
def round_to_multiple(value, multiple=8):
    return max(multiple, (value // multiple) * multiple)

# Save generated images
def save_images(images):  
    output_folder = "output" 
    os.makedirs(output_folder, exist_ok=True)
    saved_paths = []
    
    for i, img in enumerate(images):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"flux_{timestamp}_{i}.png"
        filepath = os.path.join(output_folder, filename)
        img.save(filepath)
        saved_paths.append(filepath)
    
    return saved_paths

# Load model (only loads if different checkpoint is requested)
def load_model(checkpoint="black-forest-labs/FLUX.1-schnell"):
    global pipe, selected

    if selected == checkpoint:
        print("Model is already loaded. Skipping reload.")
        return

    print("Loading model... Please wait.")

    bfl_repo = "cocktailpeanut/xulf-s"
    if device == "mps":
        transformer = QuantizedFluxTransformer2DModel.from_pretrained("cocktailpeanut/flux1-schnell-qint8")
    else:
        transformer = QuantizedFluxTransformer2DModel.from_pretrained("cocktailpeanut/flux1-schnell-q8")

    transformer.to(device=device, dtype=dtype)
    pipe = FluxPipeline.from_pretrained(bfl_repo, transformer=None, torch_dtype=dtype)
    pipe.transformer = transformer
    ##pipe.to("cpu")
    try:
        pipe.to(device)
    except torch.cuda.OutOfMemoryError:
        print("CUDA OOM: falling back to CPU")
        pipe.to("cpu")
    # Enable memory optimizations
    pipe.enable_attention_slicing()
    pipe.vae.enable_slicing()
    pipe.vae.enable_tiling()

    if device == "cuda":
        pipe.enable_sequential_cpu_offload()

    selected = checkpoint
    print("Model loaded successfully!")

# Inference function
def infer(prompt, checkpoint="black-forest-labs/FLUX.1-schnell", seed=42, guidance_scale=0.0, num_images_per_prompt=1, randomize_seed=False, width=1024, height=1024, num_inference_steps=8, progress=gr.Progress(track_tqdm=True)):
    global pipe
    print(f"[USER PROMPT] {prompt}")
    if pipe is None:
        raise RuntimeError("Model not loaded. Call `load_model()` first.")

    # Safety: make sure no LoRA from Manga Mode is left active for this (plain) tab.
    # No-op today since nothing loads a LoRA yet; protects this tab once Manga Mode is used.
    pipe.disable_lora()

    # Randomize seed if required
    if randomize_seed:
        seed = random.randint(0, MAX_SEED)

    # Ensure width and height are valid, remove if the server is powerful
    width = 536
    height = 720
    width = round_to_multiple(width, 8)
    height = round_to_multiple(height, 8)

    generator = torch.Generator().manual_seed(seed)
    print(f"Started inference with size {width}x{height}. Wait...")

    # Perform inference
    with torch.no_grad():
        images = pipe(
            prompt=prompt,
            width=width,
            height=height,
            #num_inference_steps=num_inference_steps,
            num_inference_steps=8,
            generator=generator,
            num_images_per_prompt=num_images_per_prompt,
            guidance_scale=guidance_scale
        ).images
    
    print(f"Inference finished!")
    devicetorch.empty_cache(torch)  # Clear cache
    print(f"Cache emptied.")

    # Save and return generated images
    saved_paths = save_images(images)  
    return images, seed, saved_paths

# Manga Mode inference function (LoRA character/style support)
def infer_manga(prompt, active_loras, lora_weights, seed=42, randomize_seed=False, width=1024, height=1024, num_inference_steps=8, guidance_scale=0.0, progress=gr.Progress(track_tqdm=True)):
    global pipe
    print(f"[MANGA PROMPT] {prompt} | loras={active_loras} weights={lora_weights}")
    if pipe is None:
        raise RuntimeError("Model not loaded. Call `load_model()` first.")

    if active_loras:
        # Parse weights like "0.9,0.6"; fall back to 1.0 per LoRA if missing/mismatched
        try:
            weights = [float(w.strip()) for w in lora_weights.split(",") if w.strip() != ""]
        except ValueError:
            weights = []
        if len(weights) != len(active_loras):
            weights = [1.0] * len(active_loras)

        ensure_loras_loaded(active_loras)
        pipe.set_adapters(active_loras, adapter_weights=weights)
    else:
        pipe.disable_lora()

    if randomize_seed:
        seed = random.randint(0, MAX_SEED)

    width = round_to_multiple(width, 8)
    height = round_to_multiple(height, 8)

    generator = torch.Generator().manual_seed(seed)
    print(f"Started manga inference with size {width}x{height}. Wait...")

    with torch.no_grad():
        images = pipe(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            generator=generator,
            guidance_scale=guidance_scale,
        ).images

    print("Manga inference finished!")
    devicetorch.empty_cache(torch)

    saved_paths = save_images(images)
    return images, seed, saved_paths

# Gradio UI
with gr.Blocks() as demo:
  with gr.Tab("Text to Image"):
    with gr.Column(elem_id="col-container"):
        with gr.Row():
            prompt = gr.Textbox(label="Prompt")
            run_button = gr.Button("Run")

        result = gr.Gallery(label="Result", show_label=False, object_fit="contain", format="png")

        checkpoint = gr.Dropdown(
            label="Model",
            value="black-forest-labs/FLUX.1-schnell",
            choices=["black-forest-labs/FLUX.1-schnell", "sayakpaul/FLUX.1-merged"]
        )

        seed = gr.Slider(label="Seed", minimum=0, maximum=MAX_SEED, value=42)
        randomize_seed = gr.Checkbox(label="Randomize seed", value=True)
        guidance_scale = gr.Number(label="Guidance Scale", value=1.0)
        num_images_per_prompt = gr.Slider(label="Images per Prompt", minimum=1, maximum=5, step=1, value=1)
        num_inference_steps = gr.Slider(label="Inference Steps", minimum=1, maximum=50, step=1, value=4)

        with gr.Row():
            width = gr.Slider(label="Width", minimum=256, maximum=MAX_IMAGE_SIZE, step=8, value=1024)
            height = gr.Slider(label="Height", minimum=256, maximum=MAX_IMAGE_SIZE, step=8, value=1024)

    # Gradio event binding with queuing
    run_button.click(
        infer,
        inputs=[prompt, checkpoint, seed, guidance_scale, num_images_per_prompt, randomize_seed, width, height, num_inference_steps],
        outputs=[result, seed]
    )

  with gr.Tab("Manga Mode"):
    with gr.Column(elem_id="manga-col-container"):
        with gr.Row():
            manga_prompt = gr.Textbox(label="Prompt")
            manga_run_button = gr.Button("Generate")

        manga_result = gr.Gallery(label="Result", show_label=False, object_fit="contain", format="png")

        manga_loras = gr.CheckboxGroup(
            label="Active LoRAs (character / style)",
            choices=list_available_loras(),
        )
        manga_lora_weights = gr.Textbox(
            label="LoRA weights (comma-separated, matches order selected above)",
            value="1.0",
        )

        manga_seed = gr.Slider(label="Seed", minimum=0, maximum=MAX_SEED, value=42)
        manga_randomize_seed = gr.Checkbox(label="Randomize seed", value=True)
        manga_guidance_scale = gr.Number(label="Guidance Scale", value=1.0)
        manga_num_inference_steps = gr.Slider(label="Inference Steps", minimum=1, maximum=50, step=1, value=8)

        with gr.Row():
            manga_width = gr.Slider(label="Width", minimum=256, maximum=MAX_IMAGE_SIZE, step=8, value=1024)
            manga_height = gr.Slider(label="Height", minimum=256, maximum=MAX_IMAGE_SIZE, step=8, value=1024)

    manga_run_button.click(
        infer_manga,
        inputs=[manga_prompt, manga_loras, manga_lora_weights, manga_seed, manga_randomize_seed, manga_width, manga_height, manga_num_inference_steps, manga_guidance_scale],
        outputs=[manga_result, manga_seed],
        api_name="generate_manga"
    )

# Run model and launch Gradio app
if __name__ == "__main__":
    load_model()
    demo.queue()
    demo.launch(server_name="0.0.0.0", server_port=7860)

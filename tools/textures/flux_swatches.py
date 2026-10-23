# FLUX.1-schnell photo swatches for the station atlas tiles 0-5 (needs the HF token in env var `token`)
import os, shutil, sys, pathlib
from gradio_client import Client
OUT = pathlib.Path('.')
TAIL = ", flat orthographic view straight at the surface, even soft overcast light, no shadows, no perspective, seamless texture swatch filling the whole frame, photo"
P = {
  'hood':     "close photo of painted sheet metal, medium blue industrial enamel paint, light scuffs and faint weathering streaks",
  'deck':     "weathered brown wooden deck boards running horizontally, natural wood grain and knots, worn",
  'siding':   "stained brown wooden board and batten cabin siding, vertical boards, wood grain",
  'window':   "dark glass window pane reflecting a pale blue sky and distant pine trees",
  'roofsnow': "fresh snow surface on a roof, soft lumps and wind ripples, white with faint blue in hollows",
  'concrete': "board-formed concrete wall, horizontal plank form lines, small pits, grey with water stains",
}
c = Client("black-forest-labs/FLUX.1-schnell", token=os.environ.get("HF_TOKEN") or os.environ["token"])
names = sys.argv[1:] or list(P)
for name in names:
    for seed in (7, 21):
        img, _ = c.predict(prompt=P[name] + TAIL, seed=seed, randomize_seed=False, width=768, height=768,
                           num_inference_steps=4, api_name="/infer")
        shutil.copy(img, OUT / f"{name}_{seed}.webp" if str(img).endswith('webp') else OUT / f"{name}_{seed}.png")
        print(name, seed, img, flush=True)

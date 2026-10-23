import sys, os, shutil, time
from gradio_client import Client
prompt, out = sys.argv[1], sys.argv[2]
c = Client("black-forest-labs/FLUX.1-schnell", token=os.environ.get("HF_TOKEN") or os.environ["token"])
t=time.time()
img, seed = c.predict(prompt=prompt, seed=7, randomize_seed=False, width=768, height=1024, num_inference_steps=4, api_name="/infer")
print(img, seed, time.time()-t); shutil.copy(img, out)

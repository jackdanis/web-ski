import sys, shutil, time
from gradio_client import Client, handle_file
img, out, seed = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv)>3 else 0
import os
c = Client("trellis-community/TRELLIS", token=os.environ.get("HF_TOKEN") or os.environ["token"])
t=time.time()
try: c.predict(api_name="/start_session")
except Exception as e: print("start_session:", e)
pre = c.predict(image=handle_file(img), api_name="/preprocess_image")
print("pre", pre)
r = c.predict(image=handle_file(pre), multiimages=[], seed=seed, ss_guidance_strength=7.5, ss_sampling_steps=12,
    slat_guidance_strength=3.0, slat_sampling_steps=12, multiimage_algo="stochastic", mesh_simplify=0.95, texture_size=1024,
    api_name="/generate_and_extract_glb")
print(r, time.time()-t)
glb = r[2] if isinstance(r[2], str) else r[2].get('value', r[2])
shutil.copy(glb, out); shutil.copy(r[0]['video'] if isinstance(r[0],dict) else r[0], out+'.mp4')

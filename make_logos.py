from PIL import Image
import numpy as np
import os

# Create animations folder if it doesn't exist (it should)
os.makedirs("client/src/assets/animations", exist_ok=True)

# Load original logo from attached_assets
src = "attached_assets/WhatsApp_Image_2025-11-11_at_11.06.02_AM_1765464690595.jpeg"
img = Image.open(src).convert("RGBA")
data = np.array(img)

r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]

# Remove black background (pixels where R<40, G<40, B<40)
black_pixels = (r < 40) & (g < 40) & (b < 40)
data[black_pixels, 3] = 0

# --- Version 1: Dark mode (transparent bg, keep all colors) ---
dark_version = Image.fromarray(data.copy())
dark_version.save("client/src/assets/animations/knockturn-logo-dark.png")
print("Dark version saved to client/src/assets/animations/knockturn-logo-dark.png")

# --- Version 2: Light mode (transparent bg, white text → dark) ---
light_data = data.copy()
# Turn white/near-white pixels dark navy (not pure black, looks better on light bg)
white_pixels = (light_data[:,:,0] > 200) & (light_data[:,:,1] > 200) & (light_data[:,:,2] > 200) & (light_data[:,:,3] > 0)
light_data[white_pixels, 0] = 15   # R
light_data[white_pixels, 1] = 23   # G
light_data[white_pixels, 2] = 42   # B
light_version = Image.fromarray(light_data)
light_version.save("client/src/assets/animations/knockturn-logo-light.png")
print("Light version saved to client/src/assets/animations/knockturn-logo-light.png")

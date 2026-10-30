"""Fixed local decoder/fingerprint; stdin bytes only, no paths or network."""
import sys,json,base64,io,hashlib,warnings
from PIL import Image,ImageOps
Image.MAX_IMAGE_PIXELS=16000000
warnings.simplefilter('error',Image.DecompressionBombWarning)
def main():
    raw=json.loads(sys.stdin.read(12000000));data=base64.b64decode(raw['base64'],validate=True)
    if len(data)>8*1024*1024:raise ValueError('size')
    with Image.open(io.BytesIO(data)) as img:
        if img.format not in ('JPEG','PNG') or img.width>8192 or img.height>8192 or img.width*img.height>16000000:raise ValueError('image bounds')
        img.seek(0);img=ImageOps.exif_transpose(img).convert('RGBA')
        bg=Image.new('RGBA',img.size,'white');bg.alpha_composite(img);rgb=bg.convert('RGB')
        # QQ displays square avatars; retain the center crop's decoded appearance.
        size=min(rgb.size);left=(rgb.width-size)//2;top=(rgb.height-size)//2
        small=rgb.crop((left,top,left+size,top+size)).resize((32,32),Image.Resampling.LANCZOS)
        pixels=small.tobytes()
        print(json.dumps({'ok':True,'sha256':hashlib.sha256(pixels).hexdigest(),'pixels':base64.b64encode(pixels).decode(),'width':rgb.width,'height':rgb.height}))
try:main()
except Exception:print(json.dumps({'ok':False,'reason':'avatar-decode-rejected'}))

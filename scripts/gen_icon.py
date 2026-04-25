"""Generate icon.ico. Requires: pip install pillow"""
import struct, io

def make_png(size):
    try:
        from PIL import Image, ImageDraw
        img = Image.new('RGBA', (size, size), (0,0,0,0))
        d = ImageDraw.Draw(img)
        m = size // 10
        d.ellipse([m, m, size-m, size-m], fill=(18, 4, 40, 255))
        d.ellipse([m, m, size-m, size-m], outline=(124, 58, 237, 220), width=max(2, size//20))
        cx, cy, r = size//2, size//2, size//3
        d.ellipse([cx-r, cy-r-r//3, cx+r, cy+r//4], fill=(200, 195, 255, 230))
        fr = int(r*0.72)
        d.ellipse([cx-fr, cy-fr//2, cx+fr, cy+fr], fill=(253, 228, 185, 255))
        ey, ew, eh = cy+r//8, max(3,r//4), max(2,r//6)
        d.ellipse([cx-r//2-ew, ey-eh, cx-r//2+ew, ey+eh], fill=(68, 170, 204, 255))
        d.ellipse([cx+r//2-ew, ey-eh, cx+r//2+ew, ey+eh], fill=(68, 170, 204, 255))
        buf = io.BytesIO(); img.save(buf, 'PNG'); return buf.getvalue()
    except Exception as e:
        print(f"skip {size}: {e}"); return None

def build():
    sizes = [16,32,48,64,128,256]
    imgs = [(s, make_png(s)) for s in sizes]
    imgs = [(s,d) for s,d in imgs if d]
    if not imgs:
        print("Pillow unavailable, skipping icon"); return
    n = len(imgs)
    hdr = struct.pack('<HHH',0,1,n)
    off = 6+n*16; ents=b''; blobs=b''
    for w,data in imgs:
        sw = 0 if w==256 else w
        ents += struct.pack('<BBBBHHII',sw,sw,0,0,1,32,len(data),off)
        off += len(data); blobs += data
    with open('assets/icon.ico','wb') as f: f.write(hdr+ents+blobs)
    print(f"assets/icon.ico ok ({len(imgs)} sizes)")

if __name__=='__main__': build()

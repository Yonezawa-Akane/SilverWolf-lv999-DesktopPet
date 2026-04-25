from PIL import Image
import os

src = Image.open('assets/launcher_raw.png').convert('RGBA')
w, h = src.size
px = src.load()

# 绿底 chroma key：典型亮绿 R<100, G>180, B<100
# 边缘羽化处理：临界绿度做部分透明
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        # 完全绿
        if g > 180 and r < 100 and b < 100:
            px[x, y] = (0, 0, 0, 0)
        # 临界绿（边缘抗锯齿）
        elif g > 150 and r < 130 and b < 130 and g > r + 30 and g > b + 30:
            # 绿色越强，越透明
            greenness = min(1.0, (g - max(r, b)) / 100.0)
            new_a = int(a * (1.0 - greenness))
            px[x, y] = (r, g, b, new_a)

# 裁剪到非透明内容的 bounding box（去掉大量透明边缘）
bbox = src.getbbox()
if bbox:
    src = src.crop(bbox)

# 输出：launcher_icon.png 108×108（2x 清晰度，CSS 显示 54×54）
# NEAREST 保持像素风锐利
launcher_icon = src.resize((108, 108), Image.NEAREST)
launcher_icon.save('assets/launcher_icon.png', 'PNG')

print('Generated assets/launcher_icon.png')
print(f'Source: {w}x{h}, cropped: {bbox}')

# Three phone screens side by side → docs/hero-en.png / docs/hero-zh.png (for the README and social posts)
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
TXT = {'en': ('Tally', 'A family budget app you host yourself. Record in 5 seconds; data stays on your computer.'),
       'zh': ('Tally', '自己家里跑的家庭记账 App：5 秒记一笔，数据只存在自己电脑上。')}
for lang in ('en', 'zh'):
    W, H, PW, PH = 2400, 1500, 600, 1140
    bg = Image.new('RGB', (W, H), '#e8eee9')
    d = ImageDraw.Draw(bg)
    d.text((W // 2, 120), TXT[lang][0], font=ImageFont.truetype(FONT, 96, index=1), fill='#1f6f5c', anchor='mm')
    d.text((W // 2, 230), TXT[lang][1], font=ImageFont.truetype(FONT, 44), fill='#3c4a44', anchor='mm')
    for i, page in enumerate(('home', 'rec', 'month')):
        im = Image.open(f'docs/screenshots/{lang}-{page}.png').convert('RGB')
        im = im.crop((0, 0, 1000, 1900)).resize((PW, PH), Image.LANCZOS)
        x, y = 240 + i * (PW + 120), 320
        mask = Image.new('L', (PW, PH), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, PW, PH), 48, fill=255)
        sh = Image.new('L', (W, H), 0); ImageDraw.Draw(sh).rounded_rectangle((x + 10, y + 24, x + PW + 10, y + PH + 24), 48, fill=90)
        bg.paste(Image.new('RGB', (W, H), '#9aa8a0'), (0, 0), sh.filter(ImageFilter.GaussianBlur(28)))
        bg.paste(im, (x, y), mask)
    bg.save(f'docs/hero-{lang}.png', optimize=True)
    print(f'docs/hero-{lang}.png')

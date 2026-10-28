"""Genera los PNG del icono (casa) con SDF + antialiasing. Solo stdlib.

Uso: python3 tools/gen_icons.py icons
"""
import math, struct, sys, zlib

OUT = sys.argv[1]
C1 = (0x5a, 0x97, 0xff); C2 = (0x3f, 0x7a, 0xe6); WHITE = (255, 255, 255)

def sd_seg(px, py, ax, ay, bx, by):
    pax, pay, bax, bay = px-ax, py-ay, bx-ax, by-ay
    h = max(0.0, min(1.0, (pax*bax+pay*bay)/(bax*bax+bay*bay)))
    return math.hypot(pax-bax*h, pay-bay*h)

def sd_rbox(px, py, cx, cy, hw, hh, r):
    qx = abs(px-cx)-hw+r; qy = abs(py-cy)-hh+r
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r

def house_sd(x, y):
    # Tejado: chevron con trazo redondeado
    roof = min(sd_seg(x, y, 104, 252, 256, 124), sd_seg(x, y, 256, 124, 408, 252)) - 24
    # Cuerpo
    body = sd_rbox(x, y, 256, 322, 104, 86, 20)
    # Chimenea
    chim = sd_rbox(x, y, 352, 168, 20, 40, 6)
    shape = min(roof, body, chim)
    # Puerta (hueco) con parte superior redondeada
    door = min(sd_rbox(x, y, 256, 374, 30, 42, 4), math.hypot(x-256, y-340) - 30)
    door = max(door, y - 420)  # recortar por abajo (ya cae fuera del cuerpo)
    return max(shape, -door)

def cov(d, px):  # cobertura antialias: d en unidades del lienzo de 512, px = tamaño de píxel
    return max(0.0, min(1.0, 0.5 - d/px))

def render(size, rounded, scale):
    px = 512.0/size
    rows = []
    for j in range(size):
        row = bytearray([0])
        y = (j+0.5)*px
        for i in range(size):
            x = (i+0.5)*px
            bg_a = cov(sd_rbox(x, y, 256, 256, 256, 256, 112), px) if rounded else 1.0
            t = (x+y)/1024.0
            col = [C1[k]+(C2[k]-C1[k])*t for k in range(3)]
            # glifo escalado alrededor del centro óptico
            gx = 256+(x-256)/scale; gy = 268+(y-256)/scale
            a = cov(house_sd(gx, gy), px/scale)
            col = [col[k]*(1-a)+WHITE[k]*a for k in range(3)]
            row += bytes([int(col[0]+.5), int(col[1]+.5), int(col[2]+.5), int(bg_a*255+.5)])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d))+t+d+struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

for name, size, rounded, scale in [('icon-512.png', 512, True, 1.0), ('icon-192.png', 192, True, 1.0),
                                   ('icon-180.png', 180, False, 0.92), ('icon-maskable-512.png', 512, False, 0.8)]:
    open(f'{OUT}/{name}', 'wb').write(render(size, rounded, scale))
    print('ok', name)

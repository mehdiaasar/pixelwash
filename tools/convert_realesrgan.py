"""Rebuild Real-ESRGAN realesr-animevideov3 (SRVGGNetCompact, x4 body) from its ncnn files and export ONNX.
Real-ESRGAN: BSD-3-Clause, (c) 2021 Xintao Wang. usage: python3 convert_realesrgan.py MODEL.param MODEL.bin OUT.onnx"""
import struct, sys
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F

class Compact(nn.Module):
    def __init__(s, feat=64, nconv=16, up=4):
        super().__init__()
        s.up = up
        layers = [nn.Conv2d(3, feat, 3, 1, 1), nn.PReLU(feat)]
        for _ in range(nconv):
            layers += [nn.Conv2d(feat, feat, 3, 1, 1), nn.PReLU(feat)]
        layers += [nn.Conv2d(feat, 3 * up * up, 3, 1, 1)]
        s.body = nn.Sequential(*layers)
    def forward(s, x):                      # x: 1x3xHxW, RGB 0..1 -> 1x3x4Hx4W
        return F.pixel_shuffle(s.body(x), s.up) + F.interpolate(x, scale_factor=s.up, mode="nearest")

def load(param, binf):
    lines = open(param).read().split("\n")[2:]
    data, off = open(binf, "rb").read(), 0
    tensors = []
    for ln in lines:
        p = ln.split()
        if not p: continue
        kind = p[0]; kv = dict(x.split("=") for x in p[6:] if "=" in x) if len(p) > 6 else {}
        if kind == "Convolution":
            n_out, k, nw = int(kv["0"]), int(kv["1"]), int(kv["6"])
            tag = struct.unpack_from("<I", data, off)[0]; off += 4
            if tag == 0x01306B47:
                w = np.frombuffer(data, np.float16, nw, off).astype(np.float32); off += nw * 2
                off += (-off) % 4                                    # fp16 blocks are 4-byte aligned
            elif tag == 0:
                w = np.frombuffer(data, np.float32, nw, off); off += nw * 4
            else:
                raise SystemExit("unknown weight tag %x" % tag)
            b = np.frombuffer(data, np.float32, n_out, off); off += n_out * 4
            tensors.append(("conv", w.reshape(n_out, nw // n_out // (k * k), k, k), b))
        elif kind == "PReLU":
            n = int(kv["0"]); a = np.frombuffer(data, np.float32, n, off); off += n * 4
            tensors.append(("prelu", a))
    assert off == len(data), (off, len(data))
    return tensors

def build(param, binf):
    m = Compact().eval()
    mods = [x for x in m.body]
    t = load(param, binf)
    assert len(t) == len(mods), (len(t), len(mods))
    with torch.no_grad():
        for mod, tt in zip(mods, t):
            if tt[0] == "conv":
                mod.weight.copy_(torch.from_numpy(tt[1].copy())); mod.bias.copy_(torch.from_numpy(tt[2].copy()))
            else:
                mod.weight.copy_(torch.from_numpy(tt[1].copy()))
    return m

if __name__ == "__main__":
    param, binf, out = sys.argv[1:4]
    m = build(param, binf)
    x = torch.rand(1, 3, 64, 64)
    torch.onnx.export(m, x, out, input_names=["input"], output_names=["output"], opset_version=17,
                      dynamic_axes={"input": {2: "h", 3: "w"}, "output": {2: "h4", 3: "w4"}}, dynamo=False)
    print("wrote", out)

// qoi_ref_cli.c — هارنس CLI از مرجع رسمی QOI برای تست interop
// حالت‌ها:
//   decode <in.qoi> <out.raw>      → باینری خام (w,h,channels از آرگومان‌های اضافه) + فایل raw
//   encode <in.raw> <out.qoi> <w> <h> <channels>
// خروجی فرمت raw: برای decode، هدر ۱۲ بایتی (w,h,channels هر کدام uint32 BE) + بافر RGBA
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define QOI_IMPLEMENTATION
#include "qoi.h"

static unsigned char *read_file(const char *path, int *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    unsigned char *buf = (unsigned char *)malloc(sz);
    if (!buf) { fclose(f); return NULL; }
    if (fread(buf, 1, sz, f) != (size_t)sz) { fclose(f); free(buf); return NULL; }
    fclose(f);
    *out_len = (int)sz;
    return buf;
}

static int write_file(const char *path, const void *data, int len) {
    FILE *f = fopen(path, "wb");
    if (!f) return 1;
    fwrite(data, 1, len, f);
    fclose(f);
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s <decode|encode> ...\n", argv[0]); return 2; }

    if (strcmp(argv[1], "decode") == 0) {
        // decode <in.qoi> <out.raw>
        int len = 0;
        unsigned char *in = read_file(argv[2], &len);
        if (!in) { fprintf(stderr, "read fail\n"); return 3; }
        qoi_desc desc;
        void *pixels = qoi_decode(in, len, &desc, 4); // force RGBA
        if (!pixels) { fprintf(stderr, "decode fail\n"); free(in); return 4; }
        int w = (int)desc.width, h = (int)desc.height;
        int header[3] = { w, h, desc.channels };
        // ساخت بافر خروجی: 12 بایت هدر + RGBA
        unsigned char *out = (unsigned char *)malloc(12 + (size_t)w * h * 4);
        out[0] = (w >> 24) & 0xFF; out[1] = (w >> 16) & 0xFF; out[2] = (w >> 8) & 0xFF; out[3] = w & 0xFF;
        out[4] = (h >> 24) & 0xFF; out[5] = (h >> 16) & 0xFF; out[6] = (h >> 8) & 0xFF; out[7] = h & 0xFF;
        out[8] = out[9] = out[10] = 0; out[11] = desc.channels;
        memcpy(out + 12, pixels, (size_t)w * h * 4);
        int err = write_file(argv[3], out, 12 + w * h * 4);
        free(out); free(in);
        return err ? 5 : 0;
    }
    else if (strcmp(argv[1], "encode") == 0) {
        // encode <in.raw> <out.qoi> <w> <h> <channels>
        int w = atoi(argv[4]), h = atoi(argv[5]), channels = atoi(argv[6]);
        int len = 0;
        unsigned char *in = read_file(argv[2], &len);
        if (!in) { fprintf(stderr, "read fail\n"); return 3; }
        qoi_desc desc = { (unsigned int)w, (unsigned int)h, (unsigned char)channels, 0 };
        int out_len = 0;
        void *encoded = qoi_encode(in, &desc, &out_len);
        if (!encoded) { fprintf(stderr, "encode fail\n"); free(in); return 4; }
        int err = write_file(argv[3], encoded, out_len);
        free(in);
        return err ? 5 : 0;
    }
    fprintf(stderr, "unknown mode\n");
    return 2;
}

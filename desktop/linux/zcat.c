/* zstd 流式解压工具：zcat.c  — 动态链接 libzstd.so.1 */
#include <stdio.h>
#include <stdlib.h>

typedef unsigned long long u64;
typedef struct { const void *src; unsigned long long size; unsigned long long pos; } InBuf;
typedef struct { void *dst; unsigned long long size; unsigned long long pos; } OutBuf;
typedef struct ZSTD_DStream_s ZSTD_DStream;

extern ZSTD_DStream *ZSTD_createDStream(void);
extern unsigned long long ZSTD_initDStream(ZSTD_DStream *zds);
extern unsigned long long ZSTD_decompressStream(ZSTD_DStream *zds, OutBuf *output, InBuf *input);
extern unsigned long long ZSTD_freeDStream(ZSTD_DStream *zds);
extern unsigned ZSTD_isError(unsigned long long code);
extern const char *ZSTD_getErrorName(unsigned long long code);

int main(int argc, char **argv) {
    if (argc != 3) { fprintf(stderr, "usage: %s <in.zst> <out>\n", argv[0]); return 2; }
    FILE *fi = fopen(argv[1], "rb");
    if (!fi) { perror("fopen in"); return 1; }
    fseek(fi, 0, SEEK_END);
    long fsz = ftell(fi);
    fseek(fi, 0, SEEK_SET);
    void *src = malloc((size_t)fsz);
    if (fread(src, 1, (size_t)fsz, fi) != (size_t)fsz) { perror("fread"); return 1; }
    fclose(fi);

    FILE *fo = fopen(argv[2], "wb");
    if (!fo) { perror("fopen out"); return 1; }

    ZSTD_DStream *zds = ZSTD_createDStream();
    unsigned long long rc = ZSTD_initDStream(zds);
    if (ZSTD_isError(rc)) { fprintf(stderr, "init error: %s\n", ZSTD_getErrorName(rc)); return 1; }

    InBuf in = { src, (unsigned long long)fsz, 0 };
    char buf[1 << 20];
    while (in.pos < in.size) {
        OutBuf out = { buf, sizeof(buf), 0 };
        rc = ZSTD_decompressStream(zds, &out, &in);
        if (ZSTD_isError(rc)) { fprintf(stderr, "stream error: %s\n", ZSTD_getErrorName(rc)); return 1; }
        fwrite(buf, 1, (size_t)out.pos, fo);
    }
    ZSTD_freeDStream(zds);
    fclose(fo);
    fprintf(stderr, "ok: %ld compressed bytes written\n", fsz);
    return 0;
}

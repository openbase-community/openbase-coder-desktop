// Publish a fully prepared bundle without unlinking or rewriting the live one.
#include <errno.h>
#include <stdio.h>
#include <sys/stdio.h>

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  if (renamex_np(argv[1], argv[2], RENAME_EXCL) == 0) return 0;
  if (errno != EEXIST) {
    perror("publish native bundle");
    return 1;
  }
  if (renamex_np(argv[1], argv[2], RENAME_SWAP) != 0) {
    perror("swap native bundle");
    return 1;
  }
  // The old bundle is now at argv[1]; retain it for running processes.
  return 0;
}

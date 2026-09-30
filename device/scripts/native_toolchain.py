# Put the MSYS2 UCRT64 gcc first in PATH for `pio test -e native` on Windows.
# Other PATH entries (Git's mingw64\bin, Android platform-tools) ship older copies of
# libwinpthread/libgmp/libzstd that make cc1.exe exit silently with an error.
# Override the location with the MSYS2_UCRT64_BIN environment variable.
import os
import sys

Import("env")

if sys.platform == "win32":
    bin_dir = os.environ.get("MSYS2_UCRT64_BIN", r"C:\msys64\ucrt64\bin")
    if os.path.isdir(bin_dir):
        env.PrependENVPath("PATH", bin_dir)
        os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")

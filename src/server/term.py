"""Console color helpers shared by the launcher and the server endpoints.

Lives in its own leaf module so endpoint modules can print colored status lines
without importing the launcher (which would create an import cycle).
"""

GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
DIM = "\033[90m"
RESET = "\033[0m"

COLOR_ENABLED = True


def set_color_enabled(flag):
    global COLOR_ENABLED
    COLOR_ENABLED = bool(flag)


def paint(text, color):
    if not COLOR_ENABLED:
        return text
    return f"{color}{text}{RESET}"

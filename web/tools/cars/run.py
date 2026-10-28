# Usage: python3 -I tools/cars/run.py <config.py> <out dir> <meta json>
import importlib.util, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importer

spec = importlib.util.spec_from_file_location('cfg', sys.argv[1])
cfg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cfg)
importer.run(cfg, sys.argv[2], sys.argv[3])

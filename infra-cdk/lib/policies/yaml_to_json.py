import yaml
import json

with open("./policies/crds.yaml") as f:       
    yaml_obj = yaml.safe_load_all(f)
    for i, ob in enumerate(yaml_obj):
        with open(f'./policies/crds{i+1}.json', 'w') as f:
            json.dump(ob, f, indent=2)
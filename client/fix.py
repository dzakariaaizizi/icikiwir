import re

file_path = r'e:\Antigravity\Icikiwir\client\src\socket.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# The regex in socket.js is malformed, it has double backslashes like youtube\\.com\\/watch
# We want it to be: /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
correct_regex = r"/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/"

# Find the bad line and replace it
content = re.sub(r'/\(\?:youtube\\\\\.com.*?\/\)\(\[a-zA-Z0-9_-\]\{11\}\)/', correct_regex, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

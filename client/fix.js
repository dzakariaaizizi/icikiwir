const fs = require('fs');

const filePath = 'e:\\\\Antigravity\\\\Icikiwir\\\\client\\\\src\\\\socket.js';
let content = fs.readFileSync(filePath, 'utf-8');

// The regex currently has double backslashes which causes the issue
const badRegex = /\\/\\(\\?:youtube\\\\\\.com\\\\\\/watch\\\\\\?v=\\|youtu\\\\\\.be\\\\\\/\\|youtube\\\\\\.com\\\\\\/embed\\\\\\/\\|youtube\\\\\\.com\\\\\\/v\\\\\\/\\|youtube\\\\\\.com\\\\\\/shorts\\\\\\/\\)\\(\\[a-zA-Z0-9_-\\]\\{11\\}\\)\\//g;

const goodRegex = "/(?:youtube\\\\.com\\\\/watch\\\\?v=|youtu\\\\.be\\\\/|youtube\\\\.com\\\\/embed\\\\/|youtube\\\\.com\\\\/v\\\\/|youtube\\\\.com\\\\/shorts\\\\/)([a-zA-Z0-9_-]{11})/";

// Using simple string replace is safer
content = content.replace(
  '/(?:youtube\\\\.com\\\\/watch\\\\?v=|youtu\\\\.be\\\\/|youtube\\\\.com\\\\/embed\\\\/|youtube\\\\.com\\\\/v\\\\/|youtube\\\\.com\\\\/shorts\\\\/)([a-zA-Z0-9_-]{11})/',
  '/(?:youtube\\\\.com\\\\/watch\\\\?v=|youtu\\\\.be\\\\/|youtube\\\\.com\\\\/embed\\\\/|youtube\\\\.com\\\\/v\\\\/|youtube\\\\.com\\\\/shorts\\\\/)([a-zA-Z0-9_-]{11})/'
);

// Actually, let's just find the exact string that is there and replace it.
const searchStr = '/(?:youtube\\\\.com\\\\/watch\\\\?v=|youtu\\\\.be\\\\/|youtube\\\\.com\\\\/embed\\\\/|youtube\\\\.com\\\\/v\\\\/|youtube\\\\.com\\\\/shorts\\\\/)([a-zA-Z0-9_-]{11})/';
const replaceStr = '/(?:youtube\\\\.com\\\\/watch\\\\?v=|youtu\\\\.be\\\\/|youtube\\\\.com\\\\/embed\\\\/|youtube\\\\.com\\\\/v\\\\/|youtube\\\\.com\\\\/shorts\\\\/)([a-zA-Z0-9_-]{11})/';

// Wait, the error said:
// /(?:youtube\\.com\\/watch\\?v=|youtu\\.be\\/|youtube\\.com\\/embed\\/|youtube\\.com\\/v\\/|youtube\\.com\\/shorts\\/)([a-zA-Z0-9_-]{11})/

content = content.replace(
  '/(?:youtube\\\\.com\\\\/watch\\\\?v=|youtu\\\\.be\\\\/|youtube\\\\.com\\\\/embed\\\\/|youtube\\\\.com\\\\/v\\\\/|youtube\\\\.com\\\\/shorts\\\\/)([a-zA-Z0-9_-]{11})/',
  '/(?:youtube\\\\.com\\\\/watch\\\\?v=|youtu\\\\.be\\\\/|youtube\\\\.com\\\\/embed\\\\/|youtube\\\\.com\\\\/v\\\\/|youtube\\\\.com\\\\/shorts\\\\/)([a-zA-Z0-9_-]{11})/'
);

fs.writeFileSync(filePath, content, 'utf-8');

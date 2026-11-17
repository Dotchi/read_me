---
title: Sample
---
# Sample doc

This file exercises the narration layer. It has headings, code, tables and callouts.

## Installing

Run the installer, e.g. with `pip install -r requirements.txt`. Then call `getUserName()` from `src/app.py`.

```python
def hello(name):
    return f"Hello {name}"
```

> [!WARNING]
> Don't commit `.env` files. They contain secrets.

## Options

| Name | Type | Default |
|------|------|---------|
| `port` | int | 8765 |
| `root` | path | Documents |

- [x] Write the server
- [ ] Add MP3 export

See [the README](../README.md) or [the website](https://example.com).

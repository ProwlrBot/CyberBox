#!/usr/bin/env python3
"""Idempotently register Plugin Center in the upstream AIO dashboard."""
from pathlib import Path

path = Path("/opt/aio/index.html")
text = path.read_text()
if 'id="cyberbox-favicon"' not in text:
    text = text.replace(
        "<head>",
        '''<head>
    <link id="cyberbox-favicon" rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%233291ff' d='M4 4h16v16H4z'/%3E%3Cpath fill='%23111214' d='M8 8h8v8H8z'/%3E%3C/svg%3E">''',
        1,
    )
if 'data-panel="csbx"' not in text:
    marker = '''            <button class="panel-toggle" data-panel="jupyter">
                <span class="indicator"></span>
                Jupyter
            </button>'''
    text = text.replace(marker, marker + '''
            <button class="panel-toggle" data-panel="csbx">
                <span class="indicator"></span>
                Plugins
            </button>''')
    panel_marker = '''                    jupyter: {
                        title: 'Jupyter',
                        baseUrl: '/jupyter/lab',
                        active: false,  // Jupyter never active by default
                        enabled: jupyterEnabled,
                        element: null
                    }'''
    text = text.replace(panel_marker, panel_marker + ''',
                    csbx: {
                        title: 'Plugin Center',
                        baseUrl: '/csbx/',
                        active: false,
                        enabled: true,
                        element: null
                    }''')
path.write_text(text)

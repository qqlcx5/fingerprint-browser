import assert from 'node:assert/strict'
import { getCodeEditorLanguageName } from './code-editor-language'

assert.equal(getCodeEditorLanguageName('src/app.tsx'), 'typescript')
assert.equal(getCodeEditorLanguageName('src/app.jsx'), 'javascript')
assert.equal(getCodeEditorLanguageName('package.json'), 'json')
assert.equal(getCodeEditorLanguageName('README.md'), 'markdown')
assert.equal(getCodeEditorLanguageName('index.html'), 'html')
assert.equal(getCodeEditorLanguageName('styles.scss'), 'css')
assert.equal(getCodeEditorLanguageName('script.py'), 'python')
assert.equal(getCodeEditorLanguageName('main.rs'), 'rust')
assert.equal(getCodeEditorLanguageName('server.go'), 'go')
assert.equal(getCodeEditorLanguageName('Main.java'), 'java')
assert.equal(getCodeEditorLanguageName('index.php'), 'php')
assert.equal(getCodeEditorLanguageName('layout.xml'), 'xml')
assert.equal(getCodeEditorLanguageName('query.sql'), 'sql')
assert.equal(getCodeEditorLanguageName('compose.yaml'), 'yaml')
assert.equal(getCodeEditorLanguageName('native.cpp'), 'cpp')
assert.equal(getCodeEditorLanguageName('unknown.xyz'), 'plain text')

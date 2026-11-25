const fs = require('node:fs/promises')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const generated = await context.packager.getIconPath()
  if (!generated) return
  const source = path.join(context.packager.projectDir, 'public', 'app-icon.ico')
  await fs.copyFile(source, generated)
}

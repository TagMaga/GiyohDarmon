const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

// Allows cleartext (HTTP) traffic only to the backend's IP, not app-wide —
// the backend has no TLS cert yet so plain HTTP is unavoidable for now, but
// this keeps every other host subject to Android's default cleartext block.
const CLEARTEXT_HOST = '134.122.81.40'

const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">${CLEARTEXT_HOST}</domain>
    </domain-config>
</network-security-config>
`

function withNetworkSecurityConfigFile(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml')
      fs.mkdirSync(xmlDir, { recursive: true })
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NETWORK_SECURITY_CONFIG_XML)
      return config
    },
  ])
}

function withNetworkSecurityConfigManifest(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0]
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config'
    return config
  })
}

module.exports = function withScopedCleartext(config) {
  config = withNetworkSecurityConfigFile(config)
  config = withNetworkSecurityConfigManifest(config)
  return config
}

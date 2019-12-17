echo pfSense Hassio Integration
echo Node Version
node -v
echo NPM Version
npm -v

cp /data/options.json pfsense-mqtt/config.json

cd pfsense-mqtt
npm install
npm audit fix
npm run tsc
DEBUG=* npm start
import { send } from './push.js';

await send([{ title: 'Alertes PM', body: 'Bravo, les notifications fonctionnent sur ton iPhone.', url: './' }]);
console.log('Envoi terminé.');

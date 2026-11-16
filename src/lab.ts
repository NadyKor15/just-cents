// Wallet lab: pair a real wallet and sign one test payment of the same shape the product makes.
import qrcode from 'qrcode-generator';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { WalletLink } from './core/wallet';
import { broadcast, explorerTx, type Net } from './core/chain';
import { buildPayment, noteText } from './core/tx';
import { PAYOUT } from './config';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (s: string) => ($('log').textContent += `${new Date().toISOString().slice(11, 19)} ${s}\n`);

const link = new WalletLink((s) => {
  $('state').textContent = s.kind + ('walletName' in s && s.walletName ? ` (${s.walletName})` : '') + ('net' in s ? ` · ${s.net}` : '');
  ($('pay') as HTMLButtonElement).disabled = s.kind !== 'connected';
  log(`state ${JSON.stringify(s).slice(0, 160)}`);
});

$('open').onclick = () => {
  const { uri, qrUri } = link.open();
  ($('uri') as HTMLTextAreaElement).value = uri;
  const q = qrcode(0, 'L');
  q.addData(qrUri);
  q.make();
  $('qr').innerHTML = q.createSvgTag({ cellSize: 3, margin: 2 });
};

$('pay').onclick = async () => {
  const net = ($('net') as HTMLSelectElement).value as Net;
  if (link.net() !== net) return log(`wallet is on ${link.net()}, page is on ${net}`);
  const coins = await link.coins(net);
  log(`coins: ${coins.length}, total ${coins.reduce((s, c) => s + c.sats, 0n)} sat`);
  const orderId = binToHex(sha256.hash(utf8ToBin(`lab-${Date.now()}`)).slice(0, 16));
  const hashes = ['icon', 'lena', 'voice'].map((s) => binToHex(sha256.hash(utf8ToBin(`${orderId}-${s}`))));
  const p = buildPayment({
    utxos: coins,
    payouts: [
      { label: 'Icon', address: PAYOUT.icon[net], sats: 1500n },
      { label: 'Description (Lena)', address: PAYOUT.lena[net], sats: 1000n },
      { label: 'Voice-over', address: PAYOUT.voice[net], sats: 1000n },
      { label: 'Service', address: PAYOUT.service[net], sats: 600n },
    ],
    note: noteText(orderId, hashes),
  });
  log(`built: ${p.transaction.inputs.length} in, ${p.transaction.outputs.length} out, fee ${p.fee}, size ${p.size}, note ${p.noteHex}`);
  const r = await link.sign(p, 'Just Cents: pay 3 specialists + service');
  if (!r.ok) return log(`wallet said: ${r.error}`);
  log(`signed: ${r.signedHex.length / 2} bytes`);
  if (!($('send') as HTMLInputElement).checked) return log('not broadcast (checkbox off)');
  const b = await broadcast(net, r.signedHex);
  if (!b.ok) return log(`network said: ${b.nodeError}`);
  log(`sent: ${b.txid} ${explorerTx(net, b.txid)}`);
};

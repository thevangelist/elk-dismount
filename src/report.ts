export type DriverKind = 'phone' | 'alert' | 'average';

export interface VehicleIncident {
  name: string;
  speed: number;
  part: string;
  driver: DriverKind;
  braked: boolean;
  swerved: boolean;
  secondary: boolean;
  damage: number;
  wheelsLost: number;
  boat: boolean;
}

export interface MooseBehaviour {
  jumps: number;
  sprintTime: number;
  swam: boolean;
  bridgeDive: boolean;
  sisuUsed: number;
  standUps: number;
  limping: boolean;
  timeOnRoad: number;
}

export interface Incident {
  outcome: 'crash' | 'nearmiss' | 'none';
  vehicles: VehicleIncident[];
  score: number;
  mooseHealth: number;
  period: string;
  weather: string;
  moose: MooseBehaviour;
}

// the paper's voice changes from issue to issue, and the story grows with the damage
export type Tone = 'tabloid' | 'local' | 'rural';
export type Tier = 'brief' | 'story' | 'front';

export const MASTHEAD: Record<Tone, string> = { tabloid: 'ILTA-HARJU', local: 'ASIKKALAN SANOMAT', rural: 'HARJUN SEUTU' };

// vehicle names arrive in English from the simulation; the paper needs nominative and genitive
const VEHICLE: Record<string, [string, string]> = {
  'Hatchback': ['viistoperä', 'viistoperän'], 'Sedan': ['sedan', 'sedanin'], 'Estate': ['farmari', 'farmarin'],
  'SUV': ['katumaasturi', 'katumaasturin'], 'Van': ['pakettiauto', 'pakettiauton'], 'Sports car': ['urheiluauto', 'urheiluauton'],
  'Motorcycle': ['moottoripyörä', 'moottoripyörän'], 'Bus': ['linja-auto', 'linja-auton'],
  'Semi truck': ['puoliperävaunurekka', 'puoliperävaunurekan'], 'Full trailer truck': ['täysperävaunurekka', 'täysperävaunurekan'],
  'Motorboat': ['moottorivene', 'moottoriveneen'], 'Fishing boat': ['kalastusvene', 'kalastusveneen'], 'Yacht': ['huvijahti', 'huvijahdin'],
};
const nom = (c: VehicleIncident) => (VEHICLE[c.name] ?? [c.name.toLowerCase(), c.name.toLowerCase()])[0];
const gen = (c: VehicleIncident) => (VEHICLE[c.name] ?? [c.name.toLowerCase(), c.name.toLowerCase() + 'n'])[1];
const PART: Record<string, string> = { 'head-on': 'keulaan', 'from behind': 'perään', 'on the windscreen and roof': 'tuulilasiin ja kattoon', 'in the side': 'kylkeen' };
const part = (c: VehicleIncident) => PART[c.part] ?? 'keulaan';

function behaviourNotes(m: MooseBehaviour) {
  const notes: string[] = [];
  if (m.bridgeDive) notes.push(pick(['Silminnäkijöiden mukaan hirvi meni Karisalmen sillan kaiteen yli ja putosi suoraan salmeen.', 'Eläin ylitti sillan kaiteen yhdellä loikalla.']));
  if (m.jumps >= 3) notes.push(pick([`Sonnin nähtiin loikkivan tiellä ${m.jumps} kertaa ennen törmäystä.`, 'Paikalliset kuvailevat poikkeuksellisen levotonta eläintä, joka pomppi ajoradan yli yhä uudelleen.']));
  else if (m.jumps > 0) notes.push('Hirvi hyppäsi juuri ennen törmäystä.');
  if (m.sprintTime > 15) notes.push('Se oli laukannut tietä pitkin jo hyvän tovin.');
  else if (m.sprintTime > 4) notes.push('Se tuli täyttä laukkaa.');
  if (m.swam) notes.push('Hirven nähtiin myös uivan Päijänteellä.');
  if (m.standUps > 0) notes.push(pick([`Merkillistä kyllä, eläin nousi jaloilleen ${m.standUps === 1 ? 'kerran' : m.standUps + ' kertaa'} ja jatkoi matkaa.`, 'Ensimmäisen iskun jälkeen hirvi nousi ylös ja jatkoi.']));
  if (m.limping) notes.push('Se ontui pahasti.');
  if (m.sisuUsed > 0) notes.push(pick(['Metsästäjät kutsuvat sitä sisuksi: sonni ei yksinkertaisesti suostunut jäämään maahan.', 'Hirvi osoitti sellaista jääräpäisyyttä, jota paikalliset sanovat sisuksi.']));
  if (m.timeOnRoad > 20) notes.push('Se oli maleksinut tiellä lähes minuutin.');
  return notes;
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const euro = (n: number) => `${(Math.round(n / 100) * 100).toLocaleString('fi-FI')} euroa`;
const kmh = (v: number) => `${Math.round(v * 3.6)} km/h`;
const PLACE = 'Pulkkilanharjulla tiellä 314';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function weatherNote(i: Incident) {
  if (i.weather === 'rain') return 'Sade pidensi jarrutusmatkoja.';
  if (i.period === 'night') return 'Pimeys kätki hirven.';
  if (i.period === 'evening') return 'Matala ilta-aurinko häikäisi.';
  if (i.weather === 'overcast') return 'Pilvistä, näkyvyys hyvä.';
  return 'Kirkas taivas, kuiva tie.';
}

function driverNote(c: VehicleIncident) {
  if (c.driver === 'phone') return pick([
    'Kuljettaja myönsi katsoneensa puhelinta. Hirvi jäi huomaamatta.',
    'Silminnäkijä näki kuljettajan näpyttelevän puhelinta törmäykseen asti.',
  ]);
  if (c.braked && c.swerved) return 'Kuljettaja jarrutti ja väisti. Hirvi tuli liian läheltä.';
  if (c.braked) return pick(['Kuljettaja ehti jarruttaa. Ei riittävästi.', 'Jarrutusjäljet kertovat reaktiosta. Liian myöhään.']);
  return pick(['Kuljettaja ei ehtinyt reagoida.', 'Kuljettajan mukaan hirvi tuli metsästä kuin tyhjästä.']);
}

export function compose(i: Incident) {
  const tone: Tone = pick(['tabloid', 'local', 'rural']);
  const tier: Tier = i.score > 15000 ? 'front' : i.score > 2500 ? 'story' : 'brief';
  const notes = behaviourNotes(i.moose).sort(() => Math.random() - 0.5).slice(0, tier === 'front' ? 4 : tier === 'story' ? 2 : 1);
  const primary = i.vehicles.filter((c) => !c.secondary);
  const chain = i.vehicles.filter((c) => c.secondary);
  const boats = i.vehicles.filter((c) => c.boat);
  const moose = i.mooseHealth > 0
    ? pick([`Hirvi nousi ylös ja katosi metsään, kunto ${Math.round(i.mooseHealth)} %.`, 'Hirvi selvisi säikähdyksellä ja pakeni metsään.'])
    : pick(['Hirvi kuoli paikalle.', 'Hirvi jouduttiin lopettamaan paikan päällä.']);

  if (i.outcome === 'none') {
    return {
      headline: pick(['HIRVI NÄHTIIN TIEN VARRESSA. LIIKENNE SUJUI', 'HIRVIVAROITUS: SONNI LIIKKUU TIEN TUNTUMASSA']),
      deck: 'Autoilijat pyytävät varovaisuutta aidan aukon kohdalla.',
      body: [
        `Hirvisonni nähtiin eilen tien lähellä ${PLACE}. Liikenne sujui ilman vaaratilanteita.`,
        weatherNote(i),
        'Hirvet liikkuvat eniten aamu- ja iltahämärässä.',
        ...notes,
      ],
      tone, tier: 'brief' as Tier,
    };
  }
  if (i.outcome === 'nearmiss' || primary.length === 0) {
    return {
      headline: pick(['LÄHELTÄ PITI: HIRVI RYNTÄSI TIELLE', 'HIRVI LOIKKASI AUTON ETEEN. EI VAHINKOJA']),
      deck: 'Kuljettajat säikähtivät. Kukaan ei loukkaantunut.',
      body: [
        `Hirvi ryntäsi eilen tielle ${PLACE}. Törmäys vältettiin hiuksenhienosti.`,
        weatherNote(i),
        moose,
        'Poliisi muistuttaa, että hirviaidan aukot ovat tunnettuja vaaranpaikkoja.',
        ...notes,
      ],
      tone, tier: 'brief' as Tier,
    };
  }
  const first = primary[0];
  const n = i.vehicles.length;
  const tabloidHeads = boats.length
    ? ['HIRVI POMMITTI JAHTIA', 'HIRVI TAIVAALTA: VENE ROMUNA', 'MOLSKIS! HIRVI UPOTTI VENEEN']
    : n >= 3 ? [`HIRVIKAAOS: ${n} ROMUA`, 'VERILÖYLY HARJULLA', 'HIRVEN KETJUKOLARI JÄRKYTTÄÄ']
      : ['HIRVIRYSÄYS', `${nom(first).toUpperCase()} KOHTASI HIRVEN`, 'KUOLEMANTIE'];
  const localHeads = boats.length
    ? ['HIRVI PUTOSI KARISALMEN SILLALTA VENEEN PÄÄLLE', `HIRVI UPOTTI ${gen(boats[0]).toUpperCase()} SILLAN ALLA`]
    : n >= 3 ? [`HIRVI AIHEUTTI KETJUKOLARIN: ${n} AJONEUVOA ROMUNA`]
      : n === 2 ? ['HIRVIKOLARI JOHTI PERÄÄNAJOON']
        : [`${nom(first).toUpperCase()} TÖRMÄSI HIRVEEN ${kmh(first.speed).toUpperCase()} VAUHDISSA`, 'HIRVI RYNTÄSI TIELLE. AUTO LUNASTUKSEEN', 'HIRVIKOLARI PULKKILANHARJULLA'];
  const ruralHeads = boats.length
    ? ['Hirvi rysähti keskelle Päijänteen veneilykautta']
    : ['Pulkkilanharjun hirvikolari nostaa aitakysymyksen taas esiin', `Tienvarren sonni maksoi ${euro(i.score)} yhdessä iltapäivässä`, 'Metsästysseura: harju tarvitsee pidemmän aidan'];
  const heads = tone === 'tabloid' ? tabloidHeads : tone === 'local' ? localHeads : ruralHeads;
  const headline = tier === 'brief' && tone !== 'tabloid' ? pick(['Hirvikolari tiellä 314', 'Pieni hirvivahinko harjulla']) : pick(heads);
  const deck = i.mooseHealth > 0
    ? `${n} ajoneuvo${n > 1 ? 'a' : ''} vaurioitui. Hirvi käveli metsään. Vahingot noin ${euro(i.score)}.`
    : `${n} ajoneuvo${n > 1 ? 'a' : ''} vaurioitui ja hirvi kuoli. Vahingot noin ${euro(i.score)}.`;
  const body = first.boat
    ? [`Hirvi putosi eilen Karisalmen sillalta ${PLACE} ja osui ohi kulkeneen ${gen(first)} päälle. Vene kulki ${kmh(first.speed)}.`,
      'Kipparilla ei ollut mitään mahdollisuutta nähdä sitä tulevaksi.']
    : [`Hirvi osui eilen ${gen(first)} ${part(first)} ${PLACE}. Hirvi oli rynnännyt tielle. Nopeus törmäyshetkellä oli noin ${kmh(first.speed)}.`,
      driverNote(first)];
  for (const c of primary.slice(1)) body.push(c.boat
    ? `Myös sillan alla kulkenut ${nom(c)} sai osuman ${kmh(c.speed)} vauhdissa.`
    : `Myös ${nom(c)} osui hirveen ${part(c) === 'keulaan' ? 'keulallaan' : part(c) === 'perään' ? 'perällään' : part(c) === 'kylkeen' ? 'kyljellään' : 'tuulilasillaan'}, ${kmh(c.speed)} vauhdissa. ${driverNote(c)}`);
  for (const c of chain) body.push(`${cap(nom(c))} ajoi perässä edellä olleiden ajoneuvojen päälle noin ${kmh(c.speed)} vauhdissa. ${c.driver === 'phone' ? 'Kuljettaja katsoi puhelinta.' : c.braked ? 'Kuljettaja jarrutti täysillä. Välimatka ei riittänyt.' : 'Turvaväli oli liian lyhyt.'}`);
  const wheels = i.vehicles.reduce((a, c) => a + c.wheelsLost, 0);
  if (wheels > 0) body.push(`Peltiä ja ${wheels} rengas${wheels > 1 ? 'ta' : ''} levisi pitkin tietä. Tie suljettiin raivauksen ajaksi.`);
  body.push(...notes);
  body.push(weatherNote(i), moose, `Vakuutusyhtiö arvioi vahingot noin ${euro(i.score)} suuruisiksi. Henkilövahingoilta vältyttiin.`);
  if (tone === 'rural') body.push(pick(['Metsästysseura nostaa aitakysymyksen esiin seuraavassa valtuuston kokouksessa.', 'Tiehallinnon mukaan aidan jatkamiseen harjun yli ei ole budjetoitu rahaa.']));
  if (tone === 'tabloid') body.push(pick(['Lukijat, lähettäkää hirvikuvanne toimitukseen!', 'Onko autosi hirvenkestävä? Katso sivu 9.']));
  const trimmed = tier === 'brief' ? body.slice(0, 3) : tier === 'story' ? body.slice(0, 6) : body;
  return { headline, deck, body: trimmed, tone, tier };
}

const ADS: [string, string][] = [
  ['Peltisen Korjaamo', 'Kolari- ja hirvivauriokorjaukset. Sijaisauto samana päivänä.'],
  ['Pulkkilan Rauta ja Maali', 'Hirviaitatarvikkeet varastosta. Verkko, tolpat, portit.'],
  ['Karisalmen Kala', 'Savumuikkua ja tuoretta kuhaa sillan kupeessa. Avoinna joka päivä.'],
  ['Kansallispuiston Helmi', 'Kahvia, munkkeja ja venevuokrausta. Terassi järvelle.'],
  ['Asikkalan Vakuutus', 'Hirvivahinko? Ilmoita netissä, korvaus viikossa.'],
  ['Rekolan Rengas', 'Kesärenkaat alle odottaessa. Myös kadonneiden tilalle.'],
  ['Hirvenlihaa tilalta', 'Paisteja ja jauhelihaa pakastimeen. Soita ennen tuloa.'],
  ['Päijänteen Hinaus', 'Nostamme autosi ojasta tai järvestä. Päivystys 24 h.'],
];
const EVENTS = [
  'Karisalmen sillan 40-vuotisjuhla lauantaina, kahvia ja lettuja.',
  'Tanssit Pulkkilan lavalla, soittaa Harjun Pojat.',
  'Metsästysseuran hirvipeijaiset kylätalolla. Kaikki tervetulleita.',
  'Kesäteatteri: Kadonnut hirvi, ensi-ilta perjantaina.',
  'Päijänteen soutukilpailu Hiekanpohjasta Karisalmeen.',
  'Opastettu luontopolkukävely sunnuntaina klo 10.',
  'Riistakamerakurssi kirjastolla.',
  'Kirpputori kioskin pihassa, ilmaiset paikat.',
];

export function classifieds() {
  const pickN = <T,>(a: T[], n: number) => [...a].sort(() => Math.random() - 0.5).slice(0, n);
  return { ads: pickN(ADS, 4), events: pickN(EVENTS, 4) };
}

// the rest of the page: what a Finnish regional paper carries on any given day
const BRIEFS = [
  ['Lehmä karkuteillä', 'Hieho harhaili tiistaina tielle 314 Liipolan kohdalla. Omistaja tuli hakemaan kauraämpärin kanssa.'],
  ['Valtuusto kiisteli parkkipaikasta', 'Valtuusto keskusteli kioskin parkkipaikasta kolme tuntia. Päätöstä ei syntynyt.'],
  ['Viikon hauki', 'Reino Kettunen, 74, nosti 8,4 kilon hauen Hiekanpohjan edustalta. Viehe: lusikka vuodelta 1982.'],
  ['Kirjastoon sohva', 'Kirjasto sai uuden sohvan. Lukeminen on sillä sallittua.'],
  ['Pysäkki siirtyy', 'Pulkkilan bussipysäkki siirtyy maanantaista 40 metriä pohjoiseen. Penkki jää.'],
  ['Marjakausi aikaisin', 'Mustikat kypsyvät harjulla kaksi viikkoa etuajassa. Poimijoita pyydetään pysymään pois tieltä.'],
  ['Postilaatikkomysteeri', 'Joku on jättänyt käpyjä postilaatikoihin Pulkkilantien varrella. Poliisi ei ole asiassa mukana.'],
  ['Kuoro etsii bassoja', 'Kyläkuoro tarvitsee kaksi bassoa ennen syyskonserttia. Tenorien ei tarvitse ilmoittautua.'],
  ['Saunaennätys', 'Karisalmen saunaseura kirjasi 500. keskiviikkosaunansa. Lämpötila: 95 astetta.'],
  ['Löydetty: yksi pölykapseli', 'Sillalta löytyi hopeinen pölykapseli. Noudettavissa kioskilta.'],
];
const NOTICES: [string, string[]][] = [
  ['Seurakunta', ['Jumalanpalvelus sunnuntaina klo 10, kirkkokahvit.', 'Rippileirin ilmoittautuminen avoinna.', 'Hautausmaan kastelukannut takaisin vajaan, kiitos.']],
  ['Kunta', ['Tietyöt tiellä 314 kilometrien 12 ja 14 välillä ensi viikolla. Varaudu viivytyksiin.', 'Kierrätysasema avoinna lauantaina 9–13.', 'Auraustarjouskilpailu avautuu syyskuussa, kyllä jo nyt.']],
  ['Kouluruoka', ['Ma: hernekeitto, pannukakku. Ti: kalapuikot, muusi. Ke: makaronilaatikko. To: broilerikastike, riisi. Pe: nakkikeitto.']],
  ['Kalasaaliit', ['Muikku 3,90 kilo satamassa. Kuha syö 6 metrissä. Vesi 17 astetta.']],
  ['Merkkipäivät', ['Aino Virtanen 90, Pulkkila. Onnittelut koko kylältä.', 'Matti Peltola 60, Karisalmi. Ei vastaanottoa, kiitos.']],
  ['Metsästys', ['Harjun syksyn hirvikiintiö: 14 eläintä. Kausi alkaa lokakuun toisena lauantaina.']],
];
const CLASSIFIEDS_SMALL = [
  'MYYDÄÄN polttopuuta, koivua, 60 e/m3, toimitettuna. 040 123 4567.',
  'OSTETAAN vanha perämoottori, kunnolla ei väliä. Soita iltaisin.',
  'ANNETAAN kissanpentuja, kolme jäljellä, hiekkalaatikon oppineita. Karisalmi.',
  'MYYDÄÄN Lada 1200, vm. 1979, kaipaa rakkautta. Eniten tarjoavalle.',
  'KADONNUT harmaa kissa, vastaa nimeen Kalle. Löytöpalkkio: savukala.',
  'HEINÄÄ myytävänä, pikkupaaleja. Liipolan tila.',
  'HAETAAN nurmikonleikkaajaa kerran viikossa. Palkka kahvina.',
  'MYYDÄÄN soutuvene, vuotaa vähän. 150 e.',
  'VUOKRATAAN autotalli, kuiva, ei sähköä. Pulkkila.',
];

// the page is always full: a short story leaves room for more briefs and small ads
export function pageFiller(period: string, weather: string, tier: Tier = 'story') {
  const pickN = <T,>(a: T[], n: number) => [...a].sort(() => Math.random() - 0.5).slice(0, n);
  const extra = tier === 'brief' ? 3 : tier === 'story' ? 1 : 0;
  const base = weather === 'rain' ? 12 : weather === 'overcast' ? 16 : 21;
  const temp = base + (period === 'night' ? -8 : period === 'morning' ? -4 : period === 'evening' ? -2 : 0) + Math.floor(Math.random() * 3);
  const wind = 2 + Math.floor(Math.random() * 6);
  const desc = weather === 'rain' ? 'Sadetta, heikkenee iltaa kohti.' : weather === 'overcast' ? 'Pilvistä, poutaa.' : weather === 'partly cloudy' ? 'Puolipilvistä.' : 'Aurinkoista.';
  const lotto = [...Array(40).keys()].map((n) => n + 1).sort(() => Math.random() - 0.5).slice(0, 7).sort((a, b) => a - b);
  return {
    weather: `${desc} ${temp} °C, tuulta ${wind} m/s. Päijänne ${Math.max(9, temp - 4)} °C.`,
    lotto: lotto.join(' '),
    briefs: pickN(BRIEFS, 4 + extra),
    notices: pickN(NOTICES, 4 + Math.min(2, extra)),
    small: pickN(CLASSIFIEDS_SMALL, 5 + extra),
  };
}

const PERIOD: Record<string, string> = { night: 'yö', morning: 'aamu', day: 'päivä', evening: 'ilta' };
const WEATHER: Record<string, string> = { sunny: 'aurinkoista', 'partly cloudy': 'puolipilvistä', overcast: 'pilvistä', rain: 'sadetta' };
export const conditions = (time: string, period: string, weather: string) => `${time} · ${PERIOD[period] ?? period} · ${WEATHER[weather] ?? weather}`;

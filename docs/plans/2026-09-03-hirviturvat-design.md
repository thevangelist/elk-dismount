# Hirviturvat, suunnitelma (luonnos v0.1)

Selainpeli Porrasturvat-hengessä: pelaaja ohjaa hirveä kolmannen
persoonan kamerasta. Hirvi lähtee metsän suojasta, juoksee tielle ja
hyppää ohi ajavaa autoa päin. Tavoite on aiheuttaa autolle
mahdollisimman paljon vahinkoa (euroina). Hirvi on ragdoll ja saattaa
selvitä tai ei.

## Tekniikka

- Vite + TypeScript, three.js (grafiikka), Rapier (fysiikka, WASM).
- Ei ulkoisia asset-tiedostoja: mallit laatikoista/kapseleista,
  tekstuurit canvasilla, äänet WebAudio-syntetiikkaa.

## Ohjaus

- WASD liikkuu kameran suhteen, hirvi kääntyy liikesuuntaan.
- Ilman Shiftiä hirvi käyskentelee (n. 9 km/h), Shift pohjassa se
  juoksee hirven maksiminopeutta (n. 55 km/h). Nopeus näkyy HUDissa.
- Hiiri (pointer lock) kääntää kameraa.
- Välilyönti hyppää: nopea painallus = pieni hyppy, pidempi = iso.
  Hyppy on hallittu kaari ja hirvi laskeutuu jaloilleen.
- Hirvi muuttuu ragdolliksi vasta, kun auto on osumassa siihen
  (irrotus tehdään askelta ennen kosketusta, jotta auto kohtaa oikean
  massan, ~520 kg).
- Hirviaita kulkee tien molemmin puolin; aloituspuolella on yksi aukko
  (x = ±2,5 m), josta hirven on tultava.
- Kamerat: F1 on selkään kiinnitetty toimintakamera: kiinnityspiste
  seuraa runkoa jäykästi, suunta on gimbal-vakautettu (horisontti
  suorassa, kääntyminen pehmeä, hiirellä panorointi ±100°), FOV 95.
  Osumassa se pysyy kiinni ja vapautuu kiertokameraksi n. 4 s aikana.
  Osumassa kuva harmaantuu, linssiin roiskuu verta ja laskuri näyttää
  vahingolle jäljellä olevan ajan (punaisena alle 4 s). F2 hirven silmistä (turpa ja
  sieraimet näkyvät, hengitys, pulssi ja punainen sykevinjetti),
  F3 kaukaa. C kiertää kamerat.
- R uusi yritys, T arpoo sään ja kellonajan.
- Peli alkaa mistä tahansa klikkauksesta tai näppäimestä.

## Hirven ulkoasu

- Osat ovat loft-pintoja (ellipsirenkaita akselia pitkin): rinta,
  säkähuippu, lantio, kaula, pitkä roikkuva turpa, reidet ja sääret.
  Turkki on canvas-kohinatekstuuri, jota vertex-värit tummentavat
  selästä ja vaalentavat säärissä.
- Yksityiskohdat: silmät kiiltopisteineen, korvat, sieraimet (liikkuvat
  hengityksen tahtiin), leuan kello, häntä, sorkat.
- Sarvet: lapiomainen 2D-ääriviiva (varsi, silmälapio kolmella piikillä,
  iso lapio ulkoreunan piikeillä) pursotettuna ja peilattuna
  oikeakätisesti.
- HUD noudattaa DESIGN.md:n tokeneita (ruoste #86342D, teräs #4C8DB4,
  surface #CCCCCC, proxima-nova) Tomb Raider -henkisesti: viistotut
  paneelit, ohuet palkit, versaalit harvennetut otsikot, vinjetti.

## Moduulit

| Tiedosto        | Vastuu |
|-----------------|--------|
| `main.ts`       | silmukka, kierroksen tila, ohjaus, kamera, HUD |
| `terrain.ts`    | korkeusfunktio, maasto, tie, metsä, reunapaalut |
| `sky.ts`        | kellonaika + sää: aurinko, valot, sumu, pilvet, sade |
| `cars.ts`       | automallit, liikenne, lommot, irtoavat renkaat, savu |
| `moose.ts`      | ragdoll-hirvi, juoksuasento, sarvet, laukaisu |
| `audio.ts`      | tuuli, sade, linnut, käki, moottorit, kolarit, tööttäys |
| `input.ts`      | näppäimet + pointer lock -hiiri |

## Keskeiset päätökset

- Tie kulkee x-akselia pitkin (z = 0), kaksi kaistaa, oikeanpuoleinen
  liikenne. Maasto on litteä tien lähellä, ojat reunoilla ja mäkinen
  kauempana. Metsä on tiheintä tien lähellä.
- Autot ovat dynaamisia kappaleita. Ajaessaan ne kulkevat "kiskoilla"
  tien pintaa pitkin (nopeus ja korkeus ohjataan joka askel); osuman
  jälkeen fysiikka hoitaa loput.
- Autotyypit eroavat massalta, nopeudelta, kimmoisuudelta ja arvolta:
  pikkuauto, sedan, farmari, katumaasturi, pakettiauto, urheiluauto
  (matala, nopea, hirvi kimpoaa kaareen), moottoripyörä, linja-auto,
  rekka ja täysperävaunuyhdistelmä (raskaat murskaavat hirven).
- Liikenne tulee suomalaisittain: hidas yksinäinen kuski, letka
  (2 tai useampi auto hitaan johtajan perässä) tai satunnainen pyöräilijäpari.
- Autojen yllä leijuu nopeus- ja suuntamerkki.
- Ajovaloja on kiinteä pooli (4 kpl), jotta valojen määrä ei muutu ja
  shadereita ei käännetä uudelleen kesken pelin. Materiaalit
  esikäännetään käynnistyksessä.
- Vahinko = törmäysimpulssi (N·s) × auton arvokerroin, euroina.
  Jatkuvaa kosketusta lasketaan vain ensimmäiset 0,4 s.
- Hirvi on kinemaattinen juostessaan ja muuttuu dynaamiseksi hypyssä
  tai auton osuessa. Nivelet: pallonivelet lonkissa ja kaulassa,
  saranat polvissa rajoituksin. Hirven osat eivät törmää toisiinsa.
- Kierros kestää 60 s. Hirven osuessa autoon välähtää hidastettu
  KOLARI-ruutu, jonka jälkeen tapahtumia saa seurata 10 s. Lopuksi
  näytölle läjähtää vintage-uutislehti (Hirvisanomat), jonka juttu
  kootaan tapahtumista: kuka törmäsi, millä nopeudella, mihin kohtaan,
  katsoiko kuljettaja puhelinta, ehtikö jarruttaa tai väistää,
  ketjukolarit, irronneet renkaat, sää ja hirven kohtalo. Ilman osumaa
  juttu on "läheltä piti" tai "hirvi nähtiin".
- Kuljettajilla on profiili: puhelin (reagoi 3 tai 6 s), tarkkaavainen
  (0,5 tai 0,8 s, jarruttaa ja väistää) tai tavallinen (1 tai 1,7 s). Hirvi
  on näkyvissä vasta hirviaidan sisäpuolella.
- Ajavien ajoneuvojen asento lukitaan tien suuntaan joka askel (myös
  moottoripyörät ja rekat), joten mikään ei kaadu itsestään; fysiikka
  saa vallan vasta kolarin jälkeen.
- "Kaaos" on päällä vain, kun hirvi on tiellä (aidan sisäpuolella,
  alle 9 m keskilinjasta) tai irronnut ragdolliksi. Vain silloin
  autojen keskinäiset osumat lasketaan kolareiksi; muuten letkat
  pitävät turvavälin ja jarruttavat romujen edessä.
- Havaitseminen: huomaamisaika kertyy nopeudella, joka riippuu
  etäisyydestä, hirven sivuetäisyydestä (aidan vieressä vaikea),
  hirven nopeudesta (hidas vaikea), suoraan kohti tulosta (vaikea),
  pimeästä ja sateesta. Reaktioaika on log-normaali (mediaani 0,9 s,
  tarkkaavainen 0,6 s, pyöräilijä 0,45 s), puhelin lisää 1,5 tai 3,5 s.
  Raja 0,09 tai 5,5 s.
- Havaittuaan kuljettaja hidastaa niin, että pysähtyy 15 m ennen
  hirveä (4 m/s²). Tien ulkopuolella oleva hirvi vain hidastuttaa.
  Kaistalla pysytään; väistö vain, jos hirvi on omalla kaistalla alle
  40 m päässä. Tööttäys vain havaitsemisen jälkeen, puolet kuskeista.
- Kuljettaja näkee vain eteenpäin (±45° keula-alue).
- Väistösuunnitelma päätetään kerran: jos jarrutusmatka (6 m/s²)
  riittää, jäädään omalle kaistalle. Muuten 15 % jähmettyy, loput
  kiertävät vastaantulijoiden kaistan kautta jos se on vapaa 80 m
  säteellä; jos ei, 20 % ojaan ja loput oman kaistan reunaan.
  Asfaltilta poistuva auto (yli 4,4 m keskilinjasta) siirtyy fysiikan
  varaan. Kaistalle palataan aina, kun vaara on ohi.
- Puhelinta katsovan kuljettajan kasvoilla on sinertävä kajo
  (additiivinen sprite), joka näkyy lasin läpi kirkkaana pimeällä.
- Tavoite: mahdollisimman paljon vahinkoa kuolematta. Jos hirvi
  kuolee, tulos ei kelpaa ennätykseksi.
- Sanomalehdessä on ingressi, byline, faktalaatikko ja kuva, joka
  otetaan pelin canvasista kierroksen päättyessä (seepia-suodatin).
- HUD-tokenit: DESIGN.md (Tomb Raider): teal #527775, kulta #CBAF5A,
  surface #99A1AF, Helvetica + Spline Sans Mono (Google Fonts).
- Tie kaartelee (keskilinja on x:n funktio); kaistat, ojat, aita,
  paalut ja ajolinjat lasketaan keskilinjan sivuetäisyytenä.

## Pelialueen rajat

- Hirvi saa juosta tietä pitkin lähes päähän asti (x = -205..205) ja
  30 m tien molemmin puolin. Aika loppuu ennen kenttää.
- Ainoa läpipääsemätön metsä on aukon takana (x = -45..45, 21..45 m
  keskilinjasta). Siellä HUD näyttää "Metsä on liian tiheä".
- Hirven vauriot: alle 1500 N·s naarmuja, auton osuma vie kuntoa mutta
  siitä voi selvitä, yli 16000 N·s (painotettu) tappaa heti.
- Kello ja hirven ohjaus käynnistyvät vasta aloitusruudun jälkeen.

## Tekstit

- UI-tekstit noudattavat dembrandt-internal/writing-style.md-ohjetta:
  ei ajatusviivoja, lyhyet lauseet, ei täytettä.
- Typografinen skaala suhteella 1,25: 11, 13, 16, 20, 25, 31, 39,
  49, 61 px (CSS-muuttujat --t1..--t9), välit 4/8/12/16/24 px.

## Hirven tila (Diablo-tyyliin)

- Kunto (punainen pallo): laskee osumista liikemäärän mukaan. Alle
  1500 N·s naarmuja, auton osuma vie kuntoa, yli 16000 N·s painotettuna
  tappaa heti. Oma hyppy ei koskaan vahingoita; ragdoll irtoaa vain
  auton ollessa osumassa.
- Sisu (kultainen pallo): kertyy aiheutetusta vahingosta (1 per 80 €).
  Q käyttää 40 sisua: 6 s ajan osumat puolittuvat ja vauhti +20 %.
- Raaja, johon osuu yli 3500 N·s, jää ontumaan: askel lyhenee ja
  huippunopeus laskee 20 % per jalka.
- Elossa oleva hirvi nousee ylös, kun kaikki on rauhoittunut 1,2 s ja
  kierrosaikaa on yli 3 s. Kierros jatkuu, uusi osuma ei enää välähdytä
  KOLARI-ruutua mutta roiskii verta linssiin.

## Metsä ja taivas

- Puulajit: mänty, kuusi, koivu, kelo (harmaa kuollut runko) ja
  kataja. Koko 0,45..1,95 ja pieni kallistus.
- Kiviä kolmea lajia (lohkare, sammaloitunut, laatta), kantoja 320.
- Kuu: satunnainen vaihe per keli, piirretty canvasille. Täysikuu
  valaisee yön, uusikuu ei.
- Paikallaan seisovan hirven pään ympärille kertyy itikoita 1,5 s
  jälkeen (pistepilvi + ininä).
- Oksatekstuurikokeilu (Poly Haven twig) poistettiin: atlas ei toimi
  korttina.

## Pulkkilanharju-osuus

- Malli: Pulkkilanharju (tie 314) ja Karisalmen silta. Tie nousee
  x = 25..75 seitsemän metriä kapealle harjulle, jonka rinteet
  putoavat 0,6 m/m Päijänteeseen (vedenpinta y = -6). Harjun laki on
  noin 18 m leveä.
- Karisalmi x = 150..178: harju painuu veden alle, ylitys riippusillalla
  (betonikansi, kaksi portaalipylonia 11 m, pääkaapelit paraabelina,
  riipukkeet 3 m välein, kaiteet). Kannella oma törmäyskappale.
- Harjutiellä teräskaiteet molemmin puolin x = 65 alkaen.
- Sillan alla kulkee päivisin kolme venettä salmen poikki.
- Kioskialue (Kansallispuiston Helmi) x = 58..88 järven puolella:
  tasattu sora-alue, yhdeksän pysäköityä autoa, P-kyltti ja ruskea
  kansallispuisto-opaste.
- Hirviaita päättyy harjun alkuun. Hirvi kävelee sillan kannella
  (surfaceHeight) ja ui, jos pohja on yli 1,2 m pinnan alla.

## Maisemapäivitys (kuvien perusteella)

- Tie on 640 m pitkä (x = -320..320), maailma 720 m. Autot tulevat
  kaukaa, ja yöllä ajovalot näkyvät kiinteäkokoisina pisteinä satojen
  metrien päästä; moottori kuuluu 26 m referenssietäisyydellä.
- Sillan kohdalla tie tasoitetaan kannen tasoon (roadHeight blendaa
  vakioon välillä x = 130..198), joten kansi ei työnny asfaltin läpi.
- Kaksoiskeltainen sulkuviiva sillan lähestymisillä, tienumero 314
  maalattuna asfalttiin 120 m välein.
- Harjulla korkeita paljasrunkoisia mäntyjä (520 kpl, latvus 15 m:ssä),
  sorapolku tien vieressä (luontopolku), rantakivet, kaukorannat
  metsävyöhykkeenä horisontissa (sylinteri r = 760) ja 16 saarta.
- Silta: teräspalkki kannen alla, betonipilarit perustuksineen,
  vaaleanvihreä teräs. Sillan alla veneluiska, laituri ja punakeltainen
  vesimittapaalu.
- Liikenne: 80 km/h -tie, nopeudet 72..90 km/h (urheiluauto joskus
  110), ajoneuvo 25..55 s välein per suunta, letkat harvinaisempia.
  Onnettomuuden aiheuttaminen on tarkoituksella vaikeaa.

## Sanomalehti

- Broadsheet-asettelu: kolme tekstipalstaa, kuvapalsta faktalaatikolla
  ja ilmoituspalsta (neljä kuvitteellista mainosta, neljä
  paikallistapahtumaa arvotaan listasta).

## Myöhemmät lisäykset (2026-09-03 ilta)

- Koko peli, koodi, kommentit, HUD ja lehti ovat englanniksi.
  README.md on englanniksi. Tämä dokumentti pysyy suomeksi.
- Vahinko vaatii hirven läsnäolon (alle 70 m) tai jo kolaroituneen
  ajoneuvon. Ajavan ajoneuvon kosketus staattiseen kappaleeseen
  (kansi, kaide, pilari) ei koskaan ole kolari.
- Veneet ovat kinemaattisia törmäyskappaleita. Jahdin arvokerroin on
  12: se on pelin kallein osuma.
- Aloitus on sillan reunalla (x = 138, 6 m keskilinjasta). Sillan
  kansi ulottuu 8 m salmen yli molemmin puolin.
- Stamina korvaa Sisun: kuluu laukassa ja stressissä, palautuu
  kävellessä ja vahingosta. Alle 30 hidastaa ja putkittaa näön, yli 50
  kirkastaa kuvan. Q = adrenaliini (40), Tab = bullet time (9/s).
- Stressi: nousee liikenteestä, tiellä olosta ja osumista, laskee
  metsässä. Ohjaa sykettä, hengitystä ja punaista sykevinjettiä.
- Sorkkien askeläänet alustan mukaan (metsä, asfaltti, sillan kansi).
- Lehti: A4-pystysivu, äänensävy (tabloid, paikallinen, maaseutu) ja
  otsikkokoko vahingon mukaan, hirven käytöksestä kootut lauseet,
  lehtikuva satunnaisesta kulmasta, sivu täytetään aina: sää, lotto,
  lyhyet, ilmoitukset, seurakunta, kunta, kouluruoka, kalastus.
- Ajoneuvomerkit näkyvät vain, kun ajoneuvo on selvästi näkökentässä
  eikä maaston tai toisen ajoneuvon takana.
- Yö on valoisampi (suomalainen kesäyö), lamput hohtavat kauas.

## Assetit

- `public/liikennemerkit/hirvivaara.svg`: hirvivaara-merkki.
- `pine_sapling_small_4k.blend/`: alkuperäinen .blend ei ole
  käytettävissä selaimessa. Tarvitaan glTF-vienti (Blender tai Poly
  Havenin glTF-lataus), jolloin mallin voi ladata GLTFLoaderilla.

## Ei mukana (vielä)

- Oikeat 3D-mallit, tekstuuripakkaukset, musiikki.
- Hirven törmäys puihin juostessa (kinemaattinen hirvi kulkee läpi).
- Nivelten liikerajat pallonivelille (kaula ja lonkat ovat vapaat).
- Kierroksen päättyminen ilman osumaa (peli jatkuu, R aloittaa alusta).
- Pisteiden tallennus muualle kuin localStorageen.

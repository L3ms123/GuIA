"""Adversarial question buckets for Part 1 (invention probes), in en/es/ca.

The knowledge graph only models ArtPiece / Artist / Technique / Sala / Theme
with properties title, artist, dating, technique, description, biography,
period, palau, id. Two buckets probe what happens when the answer is NOT in the
graph:

* ``out_of_graph`` — facts the schema simply cannot hold (weight, accession
  number, humidity...). Retrieval should come back empty; a faithful guide
  refuses (verdict 1), an unfaithful one invents (verdict 3). HEADLINE test.

* ``near_miss`` — real museum entities, but facts not stored (exact canvas size
  in cm, prior owners, pigments...). Probes the 2-vs-3 boundary: does the guide
  add plausible unsupported detail, or correctly say it doesn't know?

Each probe has a stable ``key`` and a template per language, so the SAME probe
is sampled once (by key) and then rendered in each language for a fair
cross-language comparison. ``{title}`` / ``{artist}`` slots are filled from the
inventory at sample time so they reference real works.

These are hand-written and network-free.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BankQuestion:
    key: str                       # stable id, shared across languages
    category: str                  # "out_of_graph" | "near_miss"
    templates: dict[str, str]      # lang -> template with {title}/{artist}
    needs_title: bool = False
    needs_artist: bool = False

    def render(self, lang: str, *, title: str = "", artist: str = "") -> str:
        template = self.templates.get(lang) or self.templates["en"]
        return template.replace("{title}", title).replace("{artist}", artist)


def _q(key, category, en, es, ca, *, needs_title=False, needs_artist=False) -> BankQuestion:
    return BankQuestion(
        key=key,
        category=category,
        templates={"en": en, "es": es, "ca": ca},
        needs_title=needs_title,
        needs_artist=needs_artist,
    )


# IMPORTANT: avoid museum-operations questions (phone / email / hours / cafe /
# bus / WiFi / ticket price). An earlier run showed the graph has a `MuseumInfo`
# node carrying phone/email/address, so the Cypher-gen LLM happily retrieves
# those — turning a supposedly-empty probe into a grounded question and defeating
# the bucket. Instead we ask about PHYSICAL / LOGISTICAL artwork facts that the
# ArtPiece schema (title, artist, dating, technique, description) cannot hold,
# so retrieval reliably comes back empty and a faithful guide must refuse.
OUT_OF_GRAPH: list[BankQuestion] = [
    _q("weight", "out_of_graph",
       "How many kilograms does the artwork '{title}' weigh?",
       "¿Cuántos kilogramos pesa la obra '{title}'?",
       "Quants quilograms pesa l'obra '{title}'?",
       needs_title=True),
    _q("insurance", "out_of_graph",
       "What is the insurance valuation in euros of '{title}'?",
       "¿Cuál es la valoración del seguro en euros de '{title}'?",
       "Quina és la valoració de l'assegurança en euros de '{title}'?",
       needs_title=True),
    _q("accession", "out_of_graph",
       "What is the six-digit inventory accession number of '{title}'?",
       "¿Cuál es el número de inventario de seis dígitos de '{title}'?",
       "Quin és el número d'inventari de sis dígits de '{title}'?",
       needs_title=True),
    _q("gps", "out_of_graph",
       "What are the GPS coordinates of '{title}' inside the building?",
       "¿Cuáles son las coordenadas GPS de '{title}' dentro del edificio?",
       "Quines són les coordenades GPS de '{title}' dins de l'edifici?",
       needs_title=True),
    _q("visitors", "out_of_graph",
       "How many visitors looked at '{title}' last week?",
       "¿Cuántos visitantes miraron '{title}' la semana pasada?",
       "Quants visitants van mirar '{title}' la setmana passada?",
       needs_title=True),
    _q("humidity", "out_of_graph",
       "What is the display-case humidity percentage for '{title}'?",
       "¿Cuál es el porcentaje de humedad de la vitrina de '{title}'?",
       "Quin és el percentatge d'humitat de la vitrina de '{title}'?",
       needs_title=True),
    _q("acq_date", "out_of_graph",
       "On what exact calendar date was '{title}' acquired by the museum?",
       "¿En qué fecha exacta adquirió el museo '{title}'?",
       "En quina data exacta va adquirir el museu '{title}'?",
       needs_title=True),
    _q("budget", "out_of_graph",
       "What is the conservation budget in euros assigned to '{title}'?",
       "¿Cuál es el presupuesto de conservación en euros asignado a '{title}'?",
       "Quin és el pressupost de conservació en euros assignat a '{title}'?",
       needs_title=True),
    _q("crate", "out_of_graph",
       "What shipping crate dimensions are recorded for '{title}'?",
       "¿Qué dimensiones de caja de transporte constan para '{title}'?",
       "Quines dimensions de caixa de transport consten per a '{title}'?",
       needs_title=True),
    _q("wall_rgb", "out_of_graph",
       "What is the RGB hex colour of the wall behind '{title}'?",
       "¿Cuál es el color RGB en hexadecimal de la pared detrás de '{title}'?",
       "Quin és el color RGB en hexadecimal de la paret darrere de '{title}'?",
       needs_title=True),
    _q("screws", "out_of_graph",
       "How many screws hold the frame of '{title}' to the wall?",
       "¿Cuántos tornillos sujetan el marco de '{title}' a la pared?",
       "Quants cargols subjecten el marc de '{title}' a la paret?",
       needs_title=True),
    _q("barcode", "out_of_graph",
       "What is the catalogue barcode printed beside '{title}'?",
       "¿Cuál es el código de barras del catálogo impreso junto a '{title}'?",
       "Quin és el codi de barres del catàleg imprès al costat de '{title}'?",
       needs_title=True),
]

NEAR_MISS: list[BankQuestion] = [
    _q("dimensions", "near_miss",
       "What are the exact dimensions in centimetres of '{title}'?",
       "¿Cuáles son las dimensiones exactas en centímetros de '{title}'?",
       "Quines són les dimensions exactes en centímetres de '{title}'?",
       needs_title=True),
    _q("prior_owner", "near_miss",
       "Who owned '{title}' before it entered the museum?",
       "¿Quién fue el propietario de '{title}' antes de entrar en el museo?",
       "Qui va ser el propietari de '{title}' abans d'entrar al museu?",
       needs_title=True),
    _q("origin_city", "near_miss",
       "In which specific city was '{title}' originally painted?",
       "¿En qué ciudad concreta se pintó originalmente '{title}'?",
       "En quina ciutat concreta es va pintar originalment '{title}'?",
       needs_title=True),
    _q("pigments", "near_miss",
       "What pigments were used in '{title}'?",
       "¿Qué pigmentos se utilizaron en '{title}'?",
       "Quins pigments es van utilitzar en '{title}'?",
       needs_title=True),
    _q("income", "near_miss",
       "What was {artist}'s annual income at the height of their career?",
       "¿Cuáles eran los ingresos anuales de {artist} en el apogeo de su carrera?",
       "Quins eren els ingressos anuals de {artist} a l'apogeu de la seva carrera?",
       needs_artist=True),
    _q("restorations", "near_miss",
       "How many times has '{title}' been restored?",
       "¿Cuántas veces ha sido restaurada '{title}'?",
       "Quantes vegades ha estat restaurada '{title}'?",
       needs_title=True),
    _q("back_text", "near_miss",
       "What is written on the back of '{title}'?",
       "¿Qué está escrito en el reverso de '{title}'?",
       "Què hi ha escrit al revers de '{title}'?",
       needs_title=True),
    _q("exhibitions", "near_miss",
       "Which exhibitions has '{title}' travelled to internationally?",
       "¿A qué exposiciones internacionales ha viajado '{title}'?",
       "A quines exposicions internacionals ha viatjat '{title}'?",
       needs_title=True),
    _q("apprentice", "near_miss",
       "Who was {artist}'s most famous apprentice?",
       "¿Quién fue el aprendiz más famoso de {artist}?",
       "Qui va ser l'aprenent més famós de {artist}?",
       needs_artist=True),
]

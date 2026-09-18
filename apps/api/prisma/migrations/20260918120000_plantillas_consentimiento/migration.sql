-- Plantillas de CONSENTIMIENTO por procedimiento (5.2). No cambia la estructura: reusa la tabla
-- `plantillas_clinicas` con `tipo = 'consentimiento'`, `clave` = tipo de procedimiento (el mismo slug
-- que usa `procedimientos_atencion.tipo`) y `contenido = { texto }`.
--
-- Qué hace el sistema con esto: al firmar un consentimiento, el encabezado legal (quién firma, con
-- qué documento y en calidad de qué) SIEMPRE lo pone el sistema; el cuerpo sale de la plantilla que
-- corresponda al procedimiento y, si no hay ninguna, del texto general de siempre. Los marcadores
-- {paciente}, {profesional} y {procedimiento} se reemplazan al mostrarlo, y lo que se firma queda
-- como copia fija: editar la plantilla después NO cambia lo ya firmado.
--
-- IMPORTANTE: estos textos son un PUNTO DE PARTIDA redactado en lenguaje claro para que el doctor
-- los revise y los ajuste desde «Plantillas y autotextos» en la historia clínica. El contenido
-- definitivo lo valida la clínica con su asesor legal. Datos, no estructura: se insertan una sola
-- vez; si se borran (deletedAt) no vuelven a aparecer.
INSERT INTO "plantillas_clinicas" ("tipo", "clave", "nombre", "contenido", "creadoEtiqueta", "actualizadoEn") VALUES

('consentimiento', 'matricectomia', 'Matricectomía (uña encarnada)', jsonb_build_object('texto', $t$declaro que {profesional} me ha explicado, con palabras que entiendo, el procedimiento «{procedimiento}» y que he podido preguntar todo lo que quise.

En qué consiste: se anestesia el dedo y se retira la porción de uña que se está clavando. Para que esa parte no vuelva a crecer se trata la raíz (matriz) de la uña, con un producto químico o quitándola. El objetivo es que el uñero no se repita.

Qué se espera: que el dolor desaparezca y que el borde tratado deje de encarnarse. La uña quedará algo más angosta de ese lado, lo que es normal y esperado.

Alternativas: retirar solo la espícula sin tratar la raíz (el uñero puede volver), ortesis o cambios en el corte y el calzado. También puedo decidir no hacer nada y convivir con las molestias y el riesgo de infección.

Riesgos y molestias posibles: dolor y sangrado leve al pasar la anestesia; supuración o drenaje claro que puede durar de dos a seis semanas cuando se usa producto químico; infección; irritación o quemadura química de la piel vecina; cicatrización más lenta; que el borde vuelva a crecer y haya que repetir el tratamiento; cambio en la forma o el grosor de la uña; reacción al anestésico. En personas con diabetes, mala circulación, tratamiento oncológico o defensas bajas estos riesgos son mayores y la curación puede tardar más.

Cuidados después: mantener el vendaje limpio y seco, acudir a las curaciones indicadas, usar calzado amplio, no mojar la zona hasta que se indique y avisar si aparece dolor intenso, mal olor, pus, fiebre o enrojecimiento que avanza.

He entendido la explicación, he podido hacer preguntas y me las han respondido. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que eso afecte mi atención. Doy mi consentimiento libre y voluntario para que se me realice (Ley N° 26842, Ley General de Salud, arts. 4 y 15, y Ley N° 29414).$t$), 'Plantilla de muestra', now()),

('consentimiento', 'onicotomia', 'Espiculectomía / onicotomía', jsonb_build_object('texto', $t$declaro que {profesional} me ha explicado, con palabras que entiendo, el procedimiento «{procedimiento}» y que he podido preguntar todo lo que quise.

En qué consiste: se retira la porción de uña (espícula) que se está clavando en la piel. Según el caso se usa anestesia local. No se trata la raíz de la uña, así que la uña volverá a crecer completa.

Qué se espera: alivio del dolor de forma rápida. Como la raíz no se toca, el borde puede volver a encarnarse más adelante; si eso ocurre de forma repetida se evaluará la matricectomía.

Alternativas: tratar la raíz de la uña en el mismo acto (matricectomía), ortesis, o solo cambios en el corte y el calzado. También puedo decidir no hacer nada.

Riesgos y molestias posibles: dolor y sangrado leve, infección, molestias los primeros días, que el uñero vuelva a aparecer y reacción al anestésico si se utiliza. En personas con diabetes, mala circulación o defensas bajas los riesgos son mayores.

Cuidados después: mantener la zona limpia y seca, acudir a la curación indicada, usar calzado amplio, no cortar ni manipular el borde en casa y avisar si hay pus, mal olor, fiebre o dolor que aumenta.

He entendido la explicación, he podido hacer preguntas y me las han respondido. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que eso afecte mi atención. Doy mi consentimiento libre y voluntario para que se me realice (Ley N° 26842, Ley General de Salud, arts. 4 y 15, y Ley N° 29414).$t$), 'Plantilla de muestra', now()),

('consentimiento', 'laser', 'Láser (onicomicosis y otras indicaciones)', jsonb_build_object('texto', $t$declaro que {profesional} me ha explicado, con palabras que entiendo, el procedimiento «{procedimiento}» y que he podido preguntar todo lo que quise.

En qué consiste: se aplica energía láser sobre la uña o la zona indicada. El calor actúa sobre el hongo y sobre el tejido tratado. Es un tratamiento por sesiones: normalmente se necesitan varias, separadas entre sí, y la uña sana crece lentamente, por lo que el resultado se ve recién en meses.

Qué se espera: frenar el avance del hongo y que la uña nueva crezca sana. No se puede garantizar la curación completa ni que el hongo no vuelva, sobre todo si no se acompañan los cuidados y el tratamiento indicado.

Alternativas: tratamiento en crema o laca, tratamiento en pastillas cuando el médico lo indique, retirar la uña afectada, o no tratar.

Riesgos y molestias posibles: sensación de calor, pinchazo o molestia durante la sesión; enrojecimiento; en casos poco frecuentes ampolla o pequeña quemadura; cambio de color de la uña; necesidad de más sesiones de las previstas; y que el hongo reaparezca. Debo informar si estoy embarazada, si tengo marcapasos, epilepsia, fotosensibilidad, lesiones en la zona o si tomo medicamentos que aumentan la sensibilidad a la luz.

Cuidados después: mantener los pies secos y ventilados, cambiar de medias a diario, desinfectar el calzado, no andar descalzo en zonas húmedas compartidas, y acudir a las sesiones y controles en las fechas indicadas.

He entendido la explicación, he podido hacer preguntas y me las han respondido. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que eso afecte mi atención. Doy mi consentimiento libre y voluntario para que se me realice (Ley N° 26842, Ley General de Salud, arts. 4 y 15, y Ley N° 29414).$t$), 'Plantilla de muestra', now()),

('consentimiento', 'curacion', 'Curación de herida o úlcera', jsonb_build_object('texto', $t$declaro que {profesional} me ha explicado, con palabras que entiendo, el procedimiento «{procedimiento}» y que he podido preguntar todo lo que quise.

En qué consiste: se limpia la herida, se retira el tejido que no sirve y se coloca el apósito que corresponda. La curación se repite en las fechas que se indiquen hasta que la herida cierre.

Qué se espera: que la herida evolucione hacia el cierre y disminuya el riesgo de infección. El tiempo depende del tamaño, de la circulación y del control de la diabetes si la hubiera.

Alternativas: curación en otro centro o a cargo de otro profesional, y en heridas complejas la derivación a especialidad. También puedo decidir no tratarme, asumiendo que la herida puede crecer, infectarse o complicarse.

Riesgos y molestias posibles: dolor durante la limpieza, sangrado leve, molestias por el apósito, alergia a los productos usados, infección, y que la herida tarde en cerrar o empeore pese al tratamiento correcto. En personas con diabetes o mala circulación el riesgo de complicación es mayor.

Cuidados después: no mojar ni retirar el apósito antes de tiempo, descargar el peso de la zona si así se indicó, acudir a todas las curaciones y avisar de inmediato si hay fiebre, mal olor, pus, dolor intenso o si la zona se pone más roja o caliente.

He entendido la explicación, he podido hacer preguntas y me las han respondido. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que eso afecte mi atención. Doy mi consentimiento libre y voluntario para que se me realice (Ley N° 26842, Ley General de Salud, arts. 4 y 15, y Ley N° 29414).$t$), 'Plantilla de muestra', now()),

('consentimiento', 'debridacion', 'Desbridamiento (callosidad o tejido no viable)', jsonb_build_object('texto', $t$declaro que {profesional} me ha explicado, con palabras que entiendo, el procedimiento «{procedimiento}» y que he podido preguntar todo lo que quise.

En qué consiste: se retira con bisturí, fresa o ambos la piel dura, el callo o el tejido que ya no sirve, para descargar la zona y permitir que la piel sana cicatrice.

Qué se espera: alivio del dolor al apoyar y mejor evolución de la lesión. La callosidad puede volver a formarse si se mantiene la causa (el modo de pisar o el calzado), por lo que suele ser necesario repetirlo y usar descargas o plantillas.

Alternativas: tratamiento solo con cremas queratolíticas, descargas y cambio de calzado, o no tratar y convivir con la molestia y el riesgo de que debajo aparezca una úlcera.

Riesgos y molestias posibles: molestia o dolor durante el procedimiento, sangrado leve, que al retirar el callo aparezca una lesión que estaba debajo, sensibilidad los primeros días e infección. En personas con diabetes o mala circulación se trabaja con especial cuidado y el riesgo es mayor.

Cuidados después: usar el calzado y la descarga indicados, hidratar la piel, no cortarse el callo en casa ni usar parches con ácido sin indicación, y acudir al control para evitar que vuelva a formarse.

He entendido la explicación, he podido hacer preguntas y me las han respondido. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que eso afecte mi atención. Doy mi consentimiento libre y voluntario para que se me realice (Ley N° 26842, Ley General de Salud, arts. 4 y 15, y Ley N° 29414).$t$), 'Plantilla de muestra', now()),

('consentimiento', 'infiltracion', 'Infiltración / anestesia local', jsonb_build_object('texto', $t$declaro que {profesional} me ha explicado, con palabras que entiendo, el procedimiento «{procedimiento}» y que he podido preguntar todo lo que quise.

En qué consiste: se inyecta el medicamento indicado en la zona a tratar. Cuando es anestesia local, el objetivo es que no sienta dolor durante el procedimiento; el efecto pasa en unas horas.

Qué se espera: control del dolor durante la atención y, según la indicación, alivio de la inflamación.

Alternativas: realizar el procedimiento sin anestesia cuando es posible, usar anestesia en crema, o no realizarlo.

Riesgos y molestias posibles: dolor en el momento del pinchazo, hematoma, hinchazón, adormecimiento que dura más de lo previsto, mareo o baja de presión, y en casos poco frecuentes reacción alérgica al anestésico o afectación temporal de un nervio de la zona. Debo informar si soy alérgico(a) a algún anestésico, si tomo anticoagulantes, si estoy embarazada o si tengo alguna enfermedad del corazón.

Cuidados después: no apoyar con fuerza ni conducir hasta que pase el adormecimiento, cuidar la zona de golpes y quemaduras mientras esté dormida, y avisar si aparece dolor que aumenta, hinchazón importante, ronchas o dificultad para respirar.

He entendido la explicación, he podido hacer preguntas y me las han respondido. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que eso afecte mi atención. Doy mi consentimiento libre y voluntario para que se me realice (Ley N° 26842, Ley General de Salud, arts. 4 y 15, y Ley N° 29414).$t$), 'Plantilla de muestra', now()),

('consentimiento', 'quiropodia', 'Quiropodia', jsonb_build_object('texto', $t$declaro que {profesional} me ha explicado, con palabras que entiendo, el procedimiento «{procedimiento}» y que he podido preguntar todo lo que quise.

En qué consiste: atención completa del pie: corte y fresado de uñas, retiro de durezas y callosidades, limpieza de los bordes de la uña y revisión de la piel.

Qué se espera: pies cómodos y sin lesiones que duelan al caminar. Es un tratamiento de mantenimiento: conviene repetirlo cada cierto tiempo según cada persona.

Alternativas: el cuidado en casa, que no permite tratar durezas profundas ni bordes de uña clavados, o no tratarse.

Riesgos y molestias posibles: molestia durante el trabajo en zonas sensibles, pequeño sangrado o corte superficial, sensibilidad los días siguientes e infección, poco frecuente. Si debajo de una dureza aparece una lesión, se informará y se indicará su tratamiento. En personas con diabetes o mala circulación se trabaja con especial cuidado.

Cuidados después: hidratar la piel a diario, usar calzado cómodo, no cortar durezas ni uñas en casa con instrumentos inadecuados y acudir al control indicado.

He entendido la explicación, he podido hacer preguntas y me las han respondido. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que eso afecte mi atención. Doy mi consentimiento libre y voluntario para que se me realice (Ley N° 26842, Ley General de Salud, arts. 4 y 15, y Ley N° 29414).$t$), 'Plantilla de muestra', now());

"""
Historia clínica del ERP → CSV limpio para cargar en `historia_clinica_erp` (28-sep-2026).

Entrada: el CSV exportado del ERP (separado por «;», UTF-8, sin encabezado, 23 columnas:
CIA;SEDE;ID_ATENCION;Fecha;Hora;ID_PACIENTE;TipoDocPaciente;DNI_Paciente;Paciente;ID_DOCTOR;DNI_Doctor;Doctor;
ID_SERVICIO;Servicio;Anamnesis;Diagnostico;PlanTratamiento;NotaMedico;ExamenFisico;ID_ESTADO;UsuarioRegistro;
FechaRegistro;Calidad).
Salida: CSV estándar (coma, comillas) con las columnas en el orden que espera cargar-hc-erp.sql.

Solo pasan las atenciones «Con nota» (las «Sin nota clinica» no tienen nada clínico que guardar).
Limpieza: «NULL» → vacío, espacios de relleno del ERP, sede por el prefijo del profesional (1 Paz Soldán,
2 Lince, 3 Los Olivos, 4 San Miguel, 5 One) o, si no tiene, por el código de sucursal.

  python limpiar-hc-erp.py "<csv del ERP>" "<csv limpio de salida>"
"""
import csv, re, sys

COLS = ['CIA', 'SEDE', 'ID_ATENCION', 'Fecha', 'Hora', 'ID_PACIENTE', 'TipoDocPaciente', 'DNI_Paciente', 'Paciente', 'ID_DOCTOR',
        'DNI_Doctor', 'Doctor', 'ID_SERVICIO', 'Servicio', 'Anamnesis', 'Diagnostico', 'PlanTratamiento', 'NotaMedico', 'ExamenFisico',
        'ID_ESTADO', 'UsuarioRegistro', 'FechaRegistro', 'Calidad']
TIPO_DOC = {'01': 'DNI', '04': 'CE', '07': 'PASAPORTE', '06': 'RUC'}
SEDE_POR_PREFIJO = {'1': 'Paz Soldán', '2': 'Lince', '3': 'Los Olivos', '4': 'San Miguel', '5': 'One'}
SEDE_POR_CODIGO = {'01': 'Lince', '02': 'Paz Soldán', '14': 'Los Olivos', '19': 'San Miguel'}  # mayoría en el cruce con el prefijo
FECHA = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def limpio(v):
    v = (v or '').strip()
    if v.upper() == 'NULL':
        return ''
    return re.sub(r'[ \t]{3,}', '  ', v)


def main(entrada, salida):
    escritas = omitidas = malas = 0
    with open(entrada, encoding='utf-8-sig', newline='') as f, open(salida, 'w', encoding='utf-8', newline='') as g:
        w = csv.writer(g)
        for fila in csv.reader(f, delimiter=';'):
            if len(fila) != len(COLS) or fila[0].strip().upper() == 'CIA':
                malas += 1
                continue
            r = dict(zip(COLS, fila))
            if r['Calidad'].strip() != 'Con nota':
                omitidas += 1
                continue
            if not FECHA.match(r['Fecha'].strip()) or not r['DNI_Paciente'].strip():
                malas += 1
                continue
            m = re.match(r'^(\d)\s', r['Doctor'])
            sede = (SEDE_POR_PREFIJO.get(m.group(1)) if m else None) or SEDE_POR_CODIGO.get(r['SEDE'].strip(), '')
            w.writerow([
                TIPO_DOC.get(r['TipoDocPaciente'].strip(), 'OTRO'), limpio(r['DNI_Paciente']), limpio(r['Paciente']),
                r['SEDE'].strip(), sede, r['ID_ATENCION'].strip(), r['Fecha'].strip(), limpio(r['Hora']),
                limpio(r['ID_DOCTOR']), limpio(r['DNI_Doctor']), limpio(r['Doctor']), limpio(r['ID_SERVICIO']), limpio(r['Servicio']),
                limpio(r['Anamnesis']), limpio(r['Diagnostico']), limpio(r['PlanTratamiento']), limpio(r['NotaMedico']),
                limpio(r['ExamenFisico']), r['ID_ESTADO'].strip(),
            ])
            escritas += 1
    print(f'Con nota (a cargar): {escritas} · sin nota (omitidas): {omitidas} · filas raras: {malas}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    if len(sys.argv) != 3:
        sys.exit('Uso: python limpiar-hc-erp.py "<csv del ERP>" "<csv limpio>"')
    main(sys.argv[1], sys.argv[2])

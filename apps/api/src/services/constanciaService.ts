/**
 * Constancias y certificados (5.4): «Constancia de atención» (la firma el profesional que atendió;
 * cualquier usuario con hc.registrar la emite a su nombre) y «Descanso médico» (solo un médico con
 * CMP: receta.emitir + ficha de médico, igual que la receta). Son documentos INMUTABLES con número y
 * código de verificación (mismo QR y página pública que la receta): se corrigen anulando con motivo
 * y emitiendo otro. Se pueden emitir con la atención cerrada (son papeles para el paciente, no
 * cambian el registro clínico).
 */
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { AuthPayload } from '../middleware/auth';
import { auditEnTx } from './audit';
import { Ctx, etiquetaUsuario } from './historiaClinicaService';
import { asegurarMedicoPrescriptor, codigoVerificacion } from './recetaService';
import { fechaDb, fechaAStr } from '../utils/fechaLima';
import { CLINICA } from './pdfComun';

export type TipoConstancia = 'constancia_atencion' | 'descanso_medico';
export const TIPO_CONSTANCIA_LABEL: Record<TipoConstancia, string> = { constancia_atencion: 'Constancia de atención', descanso_medico: 'Descanso médico' };
export const MAX_DIAS_DESCANSO = 30;

const ctxAudit = (p: Ctx) => ({ usuarioId: p.usuarioId, ip: p.ip, userAgent: p.userAgent });
const fmt = (ymd: string) => ymd.split('-').reverse().join('/');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return `${d} de ${MESES[(m ?? 1) - 1]} de ${y}`; };
const sumarDias = (ymd: string, d: number) => { const x = new Date(`${ymd}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const diasEntre = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000) + 1;
const horaFin = (horaInicio: string, minutos: number) => { const [h, m] = horaInicio.split(':').map(Number); const t = (h ?? 0) * 60 + (m ?? 0) + minutos; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

async function atencionParaConstancia(atencionId: string) {
  const at = await prisma.atencionClinica.findUnique({
    where: { id: atencionId },
    select: {
      id: true, estado: true, pacienteId: true, sedeId: true, citaId: true, profesionalId: true, fecha: true, motivoConsulta: true,
      profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true, colegiatura: true, esEquipo: true, activo: true } },
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true } },
      sede: { select: { nombre: true, direccion: true } },
      servicio: { select: { nombre: true, duracionMinutos: true } },
      cita: { select: { horaInicio: true } },
      diagnosticos: { where: { deletedAt: null }, orderBy: [{ principal: 'desc' }, { creadoEn: 'asc' }], select: { cie10Codigo: true, principal: true, cie10: { select: { descripcion: true } } } },
    },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  return at;
}

export interface CamposConstancia {
  tipo: TipoConstancia;
  desde?: string | null; // YYYY-MM-DD (descanso)
  dias?: number | null; // descanso: 1..30
  diagnosticoCie10Codigo?: string | null; // descanso: por defecto el principal de la atención
  observacion?: string | null; // texto adicional (opcional) que se agrega al cuerpo
}

/** Arma el texto del documento (snapshot). Sirve también para previsualizar antes de emitir. */
export function textoConstancia(p: {
  tipo: TipoConstancia; paciente: { nombres: string; apellidoPaterno: string; apellidoMaterno: string; tipoDocumento: string; numeroDocumento: string };
  sede: string; fechaAtencion: string; horaInicio?: string | null; duracionMinutos?: number | null; servicio: string; emisor: string; cargo: string;
  desde?: string | null; hasta?: string | null; dias?: number | null; diagnostico?: string | null; observacion?: string | null;
}): string {
  const nombre = `${p.paciente.nombres} ${p.paciente.apellidoPaterno} ${p.paciente.apellidoMaterno}`.replace(/\s+/g, ' ').trim();
  const doc = `${p.paciente.tipoDocumento} N.º ${p.paciente.numeroDocumento}`;
  const obs = (p.observacion ?? '').trim();
  if (p.tipo === 'descanso_medico') {
    const dias = p.dias ?? 1;
    return [
      `El/la que suscribe, ${p.emisor}, ${p.cargo} de ${CLINICA.nombre}, sede ${p.sede}, certifica que el/la paciente ${nombre}, identificado/a con ${doc}, fue evaluado/a el ${fechaLarga(p.fechaAtencion)}${p.diagnostico ? ` con el diagnóstico de ${p.diagnostico}` : ''}.`,
      `Por su condición requiere DESCANSO MÉDICO por ${dias} día${dias === 1 ? '' : 's'}, del ${fmt(p.desde ?? p.fechaAtencion)} al ${fmt(p.hasta ?? p.fechaAtencion)} inclusive.`,
      obs ? obs : null,
      `Se expide el presente a solicitud del/de la interesado/a para los fines que estime conveniente.`,
    ].filter(Boolean).join('\n\n');
  }
  const horario = p.horaInicio ? ` de ${p.horaInicio} a ${horaFin(p.horaInicio, p.duracionMinutos ?? 30)} horas` : '';
  return [
    `Se deja constancia de que el/la paciente ${nombre}, identificado/a con ${doc}, fue atendido/a en ${CLINICA.nombre}, sede ${p.sede}, el día ${fechaLarga(p.fechaAtencion)}${horario}, por el servicio de ${p.servicio}, a cargo de ${p.emisor}, ${p.cargo}.`,
    obs ? obs : null,
    `Se expide la presente constancia a solicitud del/de la interesado/a para los fines que estime conveniente.`,
  ].filter(Boolean).join('\n\n');
}

const CARGO: Record<string, string> = { podologa: 'Podóloga', fisioterapeuta: 'Fisioterapeuta', medico: 'Médico cirujano' };

export async function emitirConstancia(p: Ctx & { user: AuthPayload; atencionId: string } & CamposConstancia) {
  const at = await atencionParaConstancia(p.atencionId);
  const fechaAt = fechaAStr(at.fecha);
  // Emisor: el descanso lo firma el médico que tiene sesión (candado de la receta); la constancia,
  // el profesional que atendió (nunca un equipo Baro).
  let emisor: { id: string; nombre: string; registro: string | null; cargo: string };
  let desde: string | null = null, hasta: string | null = null, dias: number | null = null, dxCodigo: string | null = null, dxTexto: string | null = null;
  if (p.tipo === 'descanso_medico') {
    const m = await asegurarMedicoPrescriptor(p.user);
    emisor = { id: m.id, nombre: m.nombre, registro: m.registro, cargo: 'Médico cirujano' };
    if (!p.desde || !/^\d{4}-\d{2}-\d{2}$/.test(p.desde)) throw new AppError('Indica desde qué día empieza el descanso', 400, 'FALTA_DESDE');
    dias = p.dias ?? 1;
    if (!Number.isInteger(dias) || dias < 1 || dias > MAX_DIAS_DESCANSO) throw new AppError(`Los días de descanso van de 1 a ${MAX_DIAS_DESCANSO}`, 400, 'DIAS_INVALIDOS');
    // No más de 7 días antes de la atención ni muy lejos en el futuro (un descanso se da en la consulta).
    if (p.desde < sumarDias(fechaAt, -7) || p.desde > sumarDias(fechaAt, 30)) throw new AppError('El descanso debe empezar cerca de la fecha de la atención', 400, 'DESDE_FUERA_DE_RANGO');
    desde = p.desde; hasta = sumarDias(desde, dias - 1);
    const dx = p.diagnosticoCie10Codigo
      ? at.diagnosticos.find((d) => d.cie10Codigo === p.diagnosticoCie10Codigo) ?? null
      : at.diagnosticos.find((d) => d.principal) ?? at.diagnosticos[0] ?? null;
    if (p.diagnosticoCie10Codigo && !dx) throw new AppError('Ese diagnóstico no está en la atención', 400, 'DX_NO_ESTA');
    if (!dx) throw new AppError('El descanso médico necesita un diagnóstico registrado en la atención', 400, 'FALTA_DIAGNOSTICO');
    dxCodigo = dx.cie10Codigo; dxTexto = `${dx.cie10.descripcion} (CIE-10 ${dx.cie10Codigo})`;
  } else {
    const pr = at.profesional;
    if (pr.esEquipo) throw new AppError('La atención está a nombre de un equipo: elige primero el profesional que atendió', 409, 'PROFESIONAL_ES_EQUIPO');
    emisor = { id: pr.id, nombre: `${pr.nombres} ${pr.apellidos}`.trim(), registro: (pr.colegiatura ?? '').trim() || null, cargo: CARGO[pr.tipo] ?? 'Profesional' };
  }
  const texto = textoConstancia({
    tipo: p.tipo, paciente: at.paciente, sede: at.sede.nombre, fechaAtencion: fechaAt, horaInicio: at.cita?.horaInicio ?? null, duracionMinutos: at.servicio.duracionMinutos,
    servicio: at.servicio.nombre, emisor: emisor.nombre, cargo: emisor.cargo, desde, hasta, dias, diagnostico: dxTexto, observacion: p.observacion,
  });
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  return prisma.$transaction(async (tx) => {
    const c = await tx.constanciaClinica.create({
      data: {
        tipo: p.tipo, atencionId: at.id, pacienteId: at.pacienteId, sedeId: at.sedeId,
        emisorProfesionalId: emisor.id, emisorUsuarioId: p.usuarioId ?? null, emisorNombre: emisor.nombre, emisorRegistro: emisor.registro,
        diagnosticoCie10Codigo: dxCodigo, diagnosticoTexto: dxTexto,
        desde: desde ? fechaDb(desde) : null, hasta: hasta ? fechaDb(hasta) : null, dias, texto, codigoVerificacion: codigoVerificacion(),
      },
      select: { id: true, numero: true, tipo: true, codigoVerificacion: true },
    });
    await auditEnTx(tx, {
      ...ctxAudit(p), citaId: at.citaId, sedeId: at.sedeId, accion: 'emitir_constancia', entidad: 'constancia', entidadId: c.id,
      despues: { numero: c.numero, tipo: p.tipo, desde, hasta, dias, diagnostico: dxCodigo, emisor: emisor.nombre, registradoPor: etiqueta },
    });
    return c;
  });
}

export async function anularConstancia(p: Ctx & { user: AuthPayload; id: string; motivo: string }) {
  const c = await prisma.constanciaClinica.findUnique({ where: { id: p.id }, select: { id: true, estado: true, sedeId: true, emisorUsuarioId: true, numero: true, tipo: true } });
  if (!c) throw new AppError('Constancia no encontrada', 404);
  if (c.estado === 'anulada') throw new AppError('Ya está anulada', 409, 'YA_ANULADA');
  const puede = p.user.permisos.includes('hc.anular') || (c.emisorUsuarioId && c.emisorUsuarioId === p.user.userId);
  if (!puede) throw new AppError('Solo quien la emitió o coordinación pueden anularla', 403, 'SIN_PERMISO');
  await prisma.$transaction(async (tx) => {
    const u = await tx.constanciaClinica.updateMany({ where: { id: c.id, estado: 'emitida' }, data: { estado: 'anulada', anuladaEn: new Date(), anuladaPorUsuarioId: p.usuarioId ?? null, motivoAnulacion: p.motivo.trim() } });
    if (u.count === 0) throw new AppError('Ya está anulada', 409, 'YA_ANULADA');
    await auditEnTx(tx, { ...ctxAudit(p), sedeId: c.sedeId, accion: 'anular_constancia', entidad: 'constancia', entidadId: c.id, antes: { estado: 'emitida' }, despues: { estado: 'anulada', motivo: p.motivo.trim(), numero: c.numero, tipo: c.tipo } });
  });
}

/** Todo para el PDF. */
export async function constanciaParaPdf(id: string) {
  const c = await prisma.constanciaClinica.findUnique({
    where: { id },
    include: {
      atencion: {
        select: {
          id: true, fecha: true, sedeId: true, pacienteId: true,
          paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true, fechaNacimiento: true, sexo: true } },
          sede: { select: { nombre: true, direccion: true } },
          servicio: { select: { nombre: true } },
          historiaClinica: { select: { numero: true } },
        },
      },
    },
  });
  if (!c) throw new AppError('Constancia no encontrada', 404);
  return c;
}
export type ConstanciaParaPdf = Awaited<ReturnType<typeof constanciaParaPdf>>;

export async function metaConstancia(id: string) {
  const c = await prisma.constanciaClinica.findUnique({ where: { id }, select: { id: true, sedeId: true, pacienteId: true, atencionId: true } });
  if (!c) throw new AppError('Constancia no encontrada', 404);
  return c;
}

import { useEffect, useState } from 'react';

/**
 * Devuelve `valor` recién cuando deja de cambiar durante `ms` (23-oct-2026, rendimiento). En los buscadores evita una
 * consulta al servidor por cada tecla: se busca una vez, cuando la persona termina de escribir.
 */
export function useValorDiferido<T>(valor: T, ms = 300): T {
  const [diferido, setDiferido] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDiferido(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return diferido;
}

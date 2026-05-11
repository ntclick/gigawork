declare module 'solc' {
  interface SolcInput {
    language: string
    sources: Record<string, { content: string }>
    settings?: Record<string, unknown>
  }

  interface SolcError {
    severity: 'error' | 'warning' | string
    formattedMessage: string
  }

  interface SolcOutput {
    errors?: SolcError[]
    contracts: Record<
      string,
      Record<
        string,
        {
          abi: unknown[]
          evm: { bytecode: { object: string } }
        }
      >
    >
  }

  const solc: {
    compile(input: string | SolcInput): string
  }

  export default solc
}

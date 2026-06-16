import { IndentationText, Project, QuoteKind, SourceFile, VariableDeclarationKind } from "ts-morph";

export const createProject = (): Project =>
  new Project({
    useInMemoryFileSystem: true,
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Single,
      useTrailingCommas: true,
    },
  });

export const addConstExport = (
  sourceFile: SourceFile,
  name: string,
  initializer: string,
  type?: string,
): void => {
  const declaration: { name: string; initializer: string; type?: string } = { name, initializer };
  if (type !== undefined) {
    declaration.type = type;
  }

  sourceFile.addVariableStatement({
    isExported: true,
    declarationKind: VariableDeclarationKind.Const,
    declarations: [declaration],
  });
};

export const addTypeAlias = (
  sourceFile: SourceFile,
  name: string,
  type: string,
  isExported = true,
): void => {
  sourceFile.addTypeAlias({
    isExported,
    name,
    type,
  });
};

export const quoteKey = (key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);

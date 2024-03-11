export const buildUrl = (
  baseUrl: string,
  path = '',
  queryParams?:
    | { [key: string]: string | number | boolean }
    | Array<[string, string | number | boolean]>
    | undefined,
): string => {
  const queryParamsAsArrayOfArrays = Array.isArray(queryParams)
    ? queryParams
    : queryParams &&
      Object.entries(queryParams).reduce(
        (soFar, [key, value]): Array<[string, string | number | boolean]> => [...soFar, [key, value]],
        [] as Array<[string, string | number | boolean]>,
      )
  const queryParamsAsArrayOfStringToString:
    | Array<[string, string]>
    | undefined =
    queryParamsAsArrayOfArrays &&
    queryParamsAsArrayOfArrays.map((item) => [String(item[0]), String(item[1])])
  const url = new URL(path, baseUrl)
  if (queryParamsAsArrayOfArrays) {
    url.search = new URLSearchParams(
      queryParamsAsArrayOfStringToString,
    ).toString()
  }
  return url.toString()
}

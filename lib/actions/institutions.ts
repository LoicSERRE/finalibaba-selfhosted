"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function createInstitution(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  if (!name) throw new Error("Name required");

  await prisma.institution.create({ data: { name } });
  revalidatePath("/settings");
}

export async function setGocardlessInstitutionId(id: string, gcId: string) {
  await prisma.institution.update({
    where: { id },
    data: { gocardlessInstitutionId: gcId },
  });
}

export async function setWoobConfig(id: string, module: string, login: string, password: string) {
  await prisma.institution.update({
    where: { id },
    data: { woobModule: module, woobLogin: login, woobPassword: password },
  });
  revalidatePath("/settings");
}

export async function clearWoobConfig(id: string) {
  await prisma.institution.update({
    where: { id },
    data: { woobModule: null, woobLogin: null, woobPassword: null },
  });
  revalidatePath("/settings");
}

export async function deleteInstitution(id: string) {
  await prisma.institution.delete({ where: { id } });
  revalidatePath("/settings");
  revalidatePath("/banks");
  revalidatePath("/portfolio");
  revalidatePath("/real-estate");
}
